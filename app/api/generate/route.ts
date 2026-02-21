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
    const { pdfData, docxData, text, password, mode, character_hints } = body

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

    // モードに応じてプロンプトを切り替え
    let systemPrompt = ''
    let userPrompt = scriptText

    if (mode === 'prescan') {
      systemPrompt = `Output must be in valid json format.
You are a film production breakdown AI.
Analyze the Japanese screenplay and extract character list and scene overview.

Extract:
1. All unique character names (including age in parentheses like "Name(25)")
2. All scenes with episode number, scene number, and location

Return JSON:
{
  "is_script": true,
  "characters": ["Name", "Name(age)", ...],
  "scene_list": [
    {"episode": 1, "scene_number": 1, "location": "Location Name"}
  ]
}`
    } else if (mode === 'extract') {
      const hintsText = character_hints?.join(', ') || ''
      systemPrompt = `Output must be in valid json format.
You are a film production breakdown AI.
Analyze this portion of a Japanese screenplay.

Character hints: ${hintsText}

Rules:
- Only output characters from the hints list
- Summarize action lines using verbs and nouns only
- Detect scenes by "number + location" or scene markers

Return JSON:
{
  "is_script": true,
  "characters": ["Name from hints"],
  "scenes": [
    {
      "episode": 1,
      "scene_number": 1,
      "location": "Location",
      "timeOfDay": "M/D/E/N/\"\"",
      "content": "Summary (verbs+nouns)",
      "characters": ["Present characters from hints"],
      "props": "Props",
      "notes": "Notes"
    }
  ]
}`
    } else {
      // 通常モード
      systemPrompt = `Output must be in valid json format.
You are a film production breakdown AI.
Analyze the Japanese screenplay and extract structured data.

Return JSON:
{
  "is_script": true,
  "characters": ["Name", "Name(age)"],
  "scenes": [
    {
      "scene": "1-1",
      "location": "Location",
      "timeOfDay": "M/D/E/N/\"\"",
      "content": "Summary",
      "characters": ["Present characters"],
      "props": "Props",
      "notes": "Notes"
    }
  ]
}`
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
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

    return NextResponse.json(parsedData)

  } catch (error: any) {
    return NextResponse.json(
      { error: `サーバーエラー: ${error.message || '不明なエラー'}` },
      { status: 500 }
    )
  }
}
