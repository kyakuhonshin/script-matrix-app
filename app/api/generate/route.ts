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

    const maxLength = 15000
    const truncatedText = scriptText.length > maxLength
      ? scriptText.substring(0, maxLength) + '...'
      : scriptText

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `あなたは映画・ドラマの台本解析専門家です。
入力テキストが台本フォーマットかどうかを判定し、台本の場合のみ解析してください。

【ステップ1: 台本判定】
入力テキストに以下の特徴があるか確認：
- 柱（シーン番号：◯, 〇, 1, 2, S-1, Scene 1等）
- ト書き（状況説明・演出）
- セリフ（キャラクター名：発言）
- スラッシュや括弧による演出指示

【ステップ2: 出力形式】
必ず以下のJSON形式で出力：
{
  "is_script": boolean,
  "error_message": string (is_scriptがfalseの場合のみ),
  "characters": string[] (is_scriptがtrueの場合),
  "scenes": [ (is_scriptがtrueの場合)
    {
      "scene": "1",
      "location": "場所名",
      "timeOfDay": "M/D/E/N/\"\"",
      "content": "要約（1-2文）",
      "characters": ["登場キャラ名"],
      "props": "小道具（カンマ区切り、なければ空文字）",
      "notes": "備考（なければ空文字）"
    }
  ]
}

【重要ルール】
1. is_scriptがfalseの場合：
   - error_messageに「台本形式ではないため処理できません。映画・ドラマの台本（柱・セリフ・ト書きがある形式）をアップロードしてください。」と設定
   - charactersとscenesは空配列

2. is_scriptがtrueの場合：
   - シーン記号（◯, 〇, 1, S-1, Scene 1等）を正確に認識
   - sceneは必ず「1」からの連番
   - timeOfDayは必ずM/D/E/N/空文字（日本語禁止）
   - 登場しないキャラクターは空文字（ハイフン禁止）

3. 常に有効なJSONのみ出力（マークダウン記法不要）`
        },
        {
          role: 'user',
          content: `ファイルタイプ: ${fileType}\n\nテキスト:\n${truncatedText}`
        }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })

    const content = completion.choices[0]?.message?.content

    if (!content) {
      return NextResponse.json(
        { error: 'APIからの応答が空でした' },
        { status: 500 }
      )
    }

    let parsedData: ParsedScript
    try {
      parsedData = JSON.parse(content)
    } catch (parseError) {
      return NextResponse.json(
        { error: 'APIの応答をJSONとしてパースできませんでした' },
        { status: 500 }
      )
    }

    if (!parsedData.is_script) {
      return NextResponse.json({
        is_script: false,
        error_message: parsedData.error_message || '台本形式ではありません'
      })
    }

    const formattedData = {
      is_script: true,
      characters: parsedData.characters,
      scenes: parsedData.scenes.map((scene) => ({
        scene: scene.scene,
        location: scene.location,
        timeOfDay: scene.timeOfDay,
        content: scene.content,
        characters: parsedData.characters.reduce((acc, char) => {
          acc[char] = scene.characters.includes(char)
          return acc
        }, {} as Record<string, boolean>),
        props: scene.props || '',
        notes: scene.notes || ''
      }))
    }

    return NextResponse.json(formattedData)

  } catch (error) {
    console.error('Error processing script:', error)
    return NextResponse.json(
      { error: '処理中にエラーが発生しました' },
      { status: 500 }
    )
  }
}
