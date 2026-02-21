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
    const { pdfData, docxData, text, password } = await request.json()

    // パスワードチェック
    if (password !== 'kouban2026') {
      return NextResponse.json(
        { error: 'パスワードが正しくありません' },
        { status: 401 }
      )
    }

    let scriptText = ''

    if (pdfData) {
      const buffer = Buffer.from(pdfData, 'base64')
      const pdfResult = await pdfParse(buffer)
      scriptText = pdfResult.text
    } else if (docxData) {
      const buffer = Buffer.from(docxData, 'base64')
      const docxResult = await mammoth.extractRawText({ buffer })
      scriptText = docxResult.value
    } else if (text) {
      scriptText = text
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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `あなたは熟練の助監督です。渡されるテキストは台本の『一部』です。

1. シーンの特定: 数字から始まる『1 場所名』や『第◯話』といった表記も、柱（シーンの区切り）として正しく認識してください。
2. キャラクター抽出: 断片的なト書きからでも、『椿(28)』や『椿(13)』、モノローグの『椿(M)』などを正確に特定し、別人として抽出してください。
3. 文脉補完: シーンの途中から始まっている場合は、場所や状況を推測して構造化してください。

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
- このテキストに含まれる全シーンを1つも漏らさず出力
- 有効なJSONのみ出力（マークダウン記法不要）
- エラー時は必ず error_message を設定し、is_script を false に`
        },
        {
          role: 'user',
          content: scriptText
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

    return NextResponse.json({
      is_script: true,
      characters: parsedData.characters,
      scenes: parsedData.scenes
    })

  } catch (error) {
    console.error('Error processing script:', error)
    return NextResponse.json(
      { error: '処理中にエラーが発生しました' },
      { status: 500 }
    )
  }
}
