import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'

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
  characters: string[]
  scenes: SceneData[]
}

export async function POST(request: NextRequest) {
  try {
    const { pdfData, text } = await request.json()

    let scriptText = ''

    if (pdfData) {
      const buffer = Buffer.from(pdfData, 'base64')
      const pdfResult = await pdfParse(buffer)
      scriptText = pdfResult.text
    } else if (text) {
      scriptText = text
    } else {
      return NextResponse.json(
        { error: 'PDFデータまたはテキストが提供されていません' },
        { status: 400 }
      )
    }

    if (!scriptText || scriptText.trim().length === 0) {
      return NextResponse.json(
        { error: '台本テキストを取得できませんでした' },
        { status: 400 }
      )
    }

    const maxLength = 15000
    const truncatedText = scriptText.length > maxLength
      ? scriptText.substring(0, maxLength) + '...'
      : scriptText

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `あなたは映画・ドラマの台本解析専門家です。
台本テキストを解析し、以下の厳密なルールに従ってJSONを出力してください。

【絶対遵守ルール】

1. 【シーン（柱）認識の強化】
   - シーン区切りは以下のいずれかの形式を認識：
     * 記号系：「◯」「〇」「●」「○」「◎」「◉」「☐」など
     * 数字系：「1」「2」「3」や「シーン1」「シーン 1」「S-1」「S1」「Scene 1」「Scene1」「SCENE 1」など
     * 漢数字：「一」「二」「三」など
   - 新しいシーンの始まり（柱）として正確に認識し、抽出漏れやズレがないようにする
   - 出力JSONの scene には、必ず「1」から始まる連番（整数）を付与

2. 【D/Nのアルファベット化】
   - 時間帯の表記に日本語は絶対に使わない
   - 必ず以下のアルファベットを使用：
     * 朝・モーニング・朝方・朝食時など → "M"
     * 昼・デイ・日中・正午など → "D"
     * 夕方・イブニング・夕暮れ・黄昏など → "E"
     * 夜・ナイト・深夜・夜中など → "N"
   - 不明または指定なしの場合は空文字列 "" を出力

3. 【登場人物の空白化】
   - シーンに登場しないキャラクターのセルにはハイフン「-」や「×」を使わない
   - 必ず空文字列 "" を出力
   - 登場する場合のみ "○"（マル）を使用

4. 【キャラクター名の抽出】
   - 全キャラクターを重複なく抽出
   - フルネームと呼び名がある場合はフルネームを優先
   - 群衆・モブなどは除外し、名前のあるキャラクターのみ

5. 【内容の要約】
   - 各シーンの内容を1-2文で簡潔に要約
   - 重要な出来事・感情・目的を含める

6. 【小道具と備考】
   - 小道具：そのシーンで重要な道具をカンマ区切りで列挙（なければ空文字列）
   - 備考：特記事項があれば記載（なければ空文字列）

【出力形式】
{
  "characters": ["キャラクター名1", "キャラクター名2", ...],
  "scenes": [
    {
      "scene": "1",
      "location": "場所の名称",
      "timeOfDay": "M/D/E/N/\"\"のいずれか",
      "content": "シーン内容の要約（1-2文）",
      "characters": ["登場するキャラクター名の配列"],
      "props": "小道具（カンマ区切り、ない場合は空文字列）",
      "notes": "備考（ない場合は空文字列）"
    }
  ]
}

【重要】
- 有効なJSONのみを出力（マークダウンのコードブロック記法は不要）
- コメント行は含めない
- 全シーンを網羅し、抜け漏れがないようにする`
        },
        {
          role: 'user',
          content: `以下の台本を解析して香盤表JSONを生成してください：\n\n${truncatedText}`
        }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })

    const content = completion.choices[0]?.message?.content

    if (!content) {
      return NextResponse.json(
        { error: 'OpenAI APIからの応答が空でした' },
        { status: 500 }
      )
    }

    let parsedData: ParsedScript
    try {
      parsedData = JSON.parse(content)
    } catch (parseError) {
      return NextResponse.json(
        { error: 'OpenAI APIの応答をJSONとしてパースできませんでした' },
        { status: 500 }
      )
    }

    const formattedData = {
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
      { error: '台本の処理中にエラーが発生しました' },
      { status: 500 }
    )
  }
}
