import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'

export const maxDuration = 60

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pdfData, docxData, text, password } = body

    // パスワードチェック
    if (password !== 'kouban2026') {
      return NextResponse.json(
        { error: 'パスワードが正しくありません' },
        { status: 401 }
      )
    }

    let scriptText = ''

    // ファイル解析
    if (pdfData) {
      try {
        const buffer = Buffer.from(pdfData, 'base64')
        const pdfResult = await pdfParse(buffer)
        scriptText = pdfResult.text
      } catch (pdfError: any) {
        return NextResponse.json(
          { error: `PDF解析エラー: ${pdfError.message}` },
          { status: 400 }
        )
      }
    } else if (docxData) {
      try {
        const buffer = Buffer.from(docxData, 'base64')
        const docxResult = await mammoth.extractRawText({ buffer })
        scriptText = docxResult.value
      } catch (docxError: any) {
        return NextResponse.json(
          { error: `Word解析エラー: ${docxError.message}` },
          { status: 400 }
        )
      }
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

    // 単純なプロンプト - 全シーンを漏らさず抽出
    const systemPrompt = `Output must be in valid json format.
You are a film production script analysis AI.
Extract ALL scenes from the Japanese screenplay without omission.

CRITICAL RULES:
1. Extract EVERY scene from the script, do not stop at scene 10
2. Preserve the original scene numbers from the script
3. Include ALL characters that appear in each scene
4. Write content in full detail, do not summarize or omit events
5. If the script has episode numbers like "第1話", use episode field

Return JSON:
{
  "is_script": true,
  "scenes": [
    {
      "scene_number": "1",
      "episode": "1",
      "location": "場所名",
      "dn": "D/N/M/E",
      "content": "シーンの詳細な内容。絶対に省略せず、台本にある出来事を漏れなく書くこと",
      "characters": ["椿", "トシ", "音部"],
      "props": ["小道具1", "小道具2"]
    }
  ]
}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: scriptText }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })

    const content = completion.choices[0]?.message?.content

    if (!content) {
      return NextResponse.json(
        { error: 'APIからの応答が空でした' },
        { status: 500 }
      )
    }

    let parsedData: any
    try {
      parsedData = JSON.parse(content)
    } catch (parseError: any) {
      return NextResponse.json(
        { error: `JSONパースエラー: ${parseError.message}` },
        { status: 500 }
      )
    }

    if (!parsedData.is_script) {
      return NextResponse.json({
        is_script: false,
        error_message: parsedData.error_message || '台本形式ではありません'
      })
    }

    // バックエンドでは単純にシーン配列を返す
    return NextResponse.json({
      is_script: true,
      scenes: parsedData.scenes || []
    })

  } catch (error: any) {
    return NextResponse.json(
      { error: `サーバーエラー: ${error.message || '不明なエラー'}` },
      { status: 500 }
    )
  }
}
