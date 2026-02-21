import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'

export const maxDuration = 60

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface SceneData {
  scene: string
  location: string
  timeOfDay: string
  content: string
  characters: string[]
  props: string
  notes: string
}

interface ParsedScript {
  is_script: boolean
  error_message?: string
  characters: string[]
  scenes: SceneData[]
}

// テキストをチャンクに分割
function splitTextIntoChunks(text: string, maxChunkSize: number = 7000): string[] {
  const chunks: string[] = []
  let currentChunk = ''
  
  // シーン区切りで分割（様々なパターンに対応）
  const scenePatterns = /(?=\n\s*(?:[第]?[一二三四五六七八九十百]+[話話]|SCENE\s*\d+|シーン\s*\d+|\d+[\s\.][内切本]|[◯○◎●〇]\s*\d+|\d+\s*[内切本])\s*)/gi
  const scenes = text.split(scenePatterns).filter(s => s.trim())
  
  for (const scene of scenes) {
    if ((currentChunk + scene).length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      currentChunk = scene
    } else {
      currentChunk += '\n' + scene
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }
  
  // チャンクが大きすぎる場合はさらに分割
  const finalChunks: string[] = []
  for (const chunk of chunks) {
    if (chunk.length > maxChunkSize) {
      const lines = chunk.split('\n')
      let tempChunk = ''
      for (const line of lines) {
        if ((tempChunk + line).length > maxChunkSize && tempChunk.length > 0) {
          finalChunks.push(tempChunk.trim())
          tempChunk = line
        } else {
          tempChunk += '\n' + line
        }
      }
      if (tempChunk.trim()) {
        finalChunks.push(tempChunk.trim())
      }
    } else {
      finalChunks.push(chunk)
    }
  }
  
  return finalChunks.length > 0 ? finalChunks : [text]
}

// キャラクター名から年齢を抽出
function extractCharacterWithAge(name: string): { name: string; age?: string } {
  const ageMatch = name.match(/(.+?)\s*[(\uff08](\d+)[)\uff09]/)
  if (ageMatch) {
    return { name: ageMatch[1].trim(), age: ageMatch[2] }
  }
  return { name: name.trim() }
}

// キャラクターリストを統合（年齢付きを区別）
function mergeCharacters(existing: string[], newChars: string[]): string[] {
  const merged = new Set(existing)
  for (const char of newChars) {
    const { name, age } = extractCharacterWithAge(char)
    if (age) {
      // 年齢付きは別キャラとして扱う
      merged.add(`${name}(${age})`)
    } else {
      merged.add(name)
    }
  }
  return Array.from(merged).sort()
}

export async function POST(request: NextRequest) {
  try {
    const { pdfData, docxData, text } = await request.json()

    let scriptText = ''
    let fileType = ''

    if (pdfData) {
      const buffer = Buffer.from(pdfData, 'base64')
      const pdfResult = await pdfParse(buffer)
      scriptText = pdfResult.text
      fileType = 'PDF'
    } else if (docxData) {
      const buffer = Buffer.from(docxData, 'base64')
      const docxResult = await mammoth.extractRawText({ buffer })
      scriptText = docxResult.value
      fileType = 'Word'
    } else if (text) {
      scriptText = text
      fileType = 'Text'
    } else {
      return NextResponse.json(
        { error: 'ファイルまたはテキストが提供されていません' },
        { status: 400 }
      )
    }

    if (!scriptText || scriptText.trim().length === 0) {
      return NextResponse.json(
        { error: 'テキストを取得できませんでした' },
        { status: 400 }
      )
    }

    // チャンクに分割
    const chunks = splitTextIntoChunks(scriptText, 7000)
    let allScenes: SceneData[] = []
    let allCharacters: string[] = []
    let isScriptDetected = false
    let errorMessage = ''

    // 各チャンクを処理
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `あなたは台本解析エキスパートです。このテキストチャンクから全てのシーンを抽出してください。

【台本判定基準（緩和版）】
以下のいずれかがあれば台本と判定：
1. ◯記号やシーン番号（1, 2, 3...）
2. 「第X話」「Episode X」などの話数表記
3. 役名＋カギカッコ（例：「椿「おはよう」」）
4. 場所＋時間帯の記述（例：「現代の六本木」「居酒屋・夜」）
5. ト書き・演出指示

【複数話対応】
「第X話」がある場合、シーン番号を「1-1, 1-2, 2-1...」形式で出力
（話数-シーン番号）

【登場人物の扱い】
- 役名に年齢がある場合（例：「椿(13)」）：別キャラクターとして分離
- モノローグ(N)：出演として○を付け、内容欄に「※モノローグあり」と追記
- モノローグ(M)や内心独白：通常の登場として扱う

【出力形式】
{
  "is_script": boolean,
  "error_message": string (is_scriptがfalseの場合),
  "characters": ["キャラ名", "キャラ名(年齢)", ...],
  "scenes": [
    {
      "scene": "1-1" (または "1", "2"),
      "location": "場所名",
      "timeOfDay": "M/D/E/N/\"\"",
      "content": "シーン内容要約",
      "characters": ["登場キャラ名"],
      "props": "小道具（カンマ区切り）",
      "notes": "備考"
    }
  ]
}

【重要】
- このチャンク内の全シーンを1つも漏らさず出力
- 最後のシーンが途中で切れていても、そのシーンを含める
- 有効なJSONのみ出力`
          },
          {
            role: 'user',
            content: `チャンク ${i + 1}/${chunks.length}:\n${chunk}`
          }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })

      const content = completion.choices[0]?.message?.content

      if (!content) {
        continue
      }

      let parsedData: ParsedScript
      try {
        parsedData = JSON.parse(content)
      } catch (parseError) {
        console.error('Parse error for chunk', i + 1)
        continue
      }

      if (!parsedData.is_script) {
        if (i === 0) {
          // 最初のチャンクで台本判定がfalseならエラー
          errorMessage = parsedData.error_message || '台本形式ではありません'
        }
        continue
      }

      isScriptDetected = true

      // キャラクターリストを統合
      allCharacters = mergeCharacters(allCharacters, parsedData.characters)

      // シーンを追加
      for (const scene of parsedData.scenes) {
        // シーン番号の調整（チャンク間で連番がリセットされる可能性があるため）
        allScenes.push(scene)
      }
    }

    if (!isScriptDetected) {
      return NextResponse.json({
        is_script: false,
        error_message: errorMessage || '台本形式ではありません。映画・ドラマの台本をアップロードしてください。'
      })
    }

    // シーン番号を整理・連番化
    const processedScenes = allScenes.map((scene, index) => {
      // モノローグ対応：Nがキャラクターに含まれる場合
      const hasNarration = scene.characters.some(c => c === 'N' || c === 'ナレーション')
      let content = scene.content
      if (hasNarration && !content.includes('※モノローグ')) {
        content += ' ※モノローグあり'
      }

      return {
        scene: scene.scene || String(index + 1),
        location: scene.location,
        timeOfDay: scene.timeOfDay,
        content: content,
        characters: allCharacters.reduce((acc, char) => {
          // 年齢付きキャラの処理
          const { name } = extractCharacterWithAge(char)
          // シーンのcharactersに含まれるかチェック（年齢付き含む）
          const isPresent = scene.characters.some(sc => {
            const scName = extractCharacterWithAge(sc).name
            return sc === char || scName === name
          })
          acc[char] = isPresent
          return acc
        }, {} as Record<string, boolean>),
        props: scene.props || '',
        notes: scene.notes || ''
      }
    })

    return NextResponse.json({
      is_script: true,
      characters: allCharacters,
      scenes: processedScenes
    })

  } catch (error) {
    console.error('Error processing script:', error)
    return NextResponse.json(
      { error: '処理中にエラーが発生しました' },
      { status: 500 }
    )
  }
}
