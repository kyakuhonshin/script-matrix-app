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

    console.log('API called with mode:', mode)
    console.log('Has pdfData:', !!pdfData)
    console.log('Has docxData:', !!docxData)
    console.log('Has text:', !!text)

    // パスワードチェック
    if (password !== 'kouban2026') {
      console.log('Password mismatch')
      return NextResponse.json(
        { error: 'パスワードが正しくありません' },
        { status: 401 }
      )
    }

    let scriptText = ''

    // ファイル解析
    if (pdfData) {
      console.log('Parsing PDF...')
      try {
        const buffer = Buffer.from(pdfData, 'base64')
        const pdfResult = await pdfParse(buffer)
        scriptText = pdfResult.text
        console.log('PDF parsed, length:', scriptText.length)
      } catch (pdfError: any) {
        console.error('PDF parse error:', pdfError)
        return NextResponse.json(
          { error: `PDF解析エラー: ${pdfError.message}` },
          { status: 400 }
        )
      }
    } else if (docxData) {
      console.log('Parsing DOCX...')
      try {
        const buffer = Buffer.from(docxData, 'base64')
        const docxResult = await mammoth.extractRawText({ buffer })
        scriptText = docxResult.value
        console.log('DOCX parsed, length:', scriptText.length)
      } catch (docxError: any) {
        console.error('DOCX parse error:', docxError)
        return NextResponse.json(
          { error: `Word解析エラー: ${docxError.message}` },
          { status: 400 }
        )
      }
    } else if (text) {
      scriptText = text
      console.log('Text received, length:', scriptText.length)
    } else {
      console.log('No input provided')
      return NextResponse.json(
        { error: 'ファイルまたはテキストが提供されていません' },
        { status: 400 }
      )
    }

    if (!scriptText || scriptText.trim().length === 0) {
      console.log('Empty text after parsing')
      return NextResponse.json(
        { error: 'テキストを取得できませんでした。ファイルが破損しているか、テキストを含んでいない可能性があります。' },
        { status: 400 }
      )
    }

    // モードに応じてプロンプトを切り替え
    let systemPrompt = ''
    let userPrompt = scriptText

    if (mode === 'prescan') {
      systemPrompt = `あなたはプロの映像制作スタッフ専用の解析ツールです。
入力テキストはフィクションのドラマ台本です。

【出力要件】
1. 全登場人物を抽出（年齢付きの場合は別人として区別）
2. 全シーンの「話数(episode)」「シーン番号(scene_number)」「場所(location)」をリスト化
3. 話数が不明な場合は episode: 1 とする

【出力形式】以下のJSON形式で出力してください
{
  "is_script": true,
  "characters": ["名前", "名前(年齢)", ...],
  "scene_list": [
    {"episode": 1, "scene_number": 1, "location": "場所名"}
  ]
}`
    } else if (mode === 'extract') {
      const hintsText = character_hints?.join(', ') || ''
      systemPrompt = `あなたはプロの映像制作スタッフ専用の解析ツールです。
入力テキストはフィクションのドラマ台本の一部です。

【重要】
- ヒントにない名前は出力しない
- ト書きを要約し、動詞と名詞のみで構成
- シーン判定は「数字+場所名」または「◯印」を優先

【ヒント：登場人物一覧】
${hintsText}

【出力形式】以下のJSON形式で出力してください
{
  "is_script": true,
  "characters": ["ヒントにある名前のみ"],
  "scenes": [
    {
      "episode": 1,
      "scene_number": 1,
      "location": "場所",
      "timeOfDay": "M/D/E/N/\"\"",
      "content": "要約（動詞+名詞のみ）",
      "characters": ["登場したヒント内の名前"],
      "props": "小道具",
      "notes": "備考"
    }
  ]
}`
    } else {
      // 通常モード（ファイル直接アップロード時）
      systemPrompt = `あなたはプロの映像制作スタッフ専用の解析ツールです。
入力テキストはフィクションのドラマ台本です。

【出力形式】以下のJSON形式で出力してください
{
  "is_script": true,
  "characters": ["名前", "名前(年齢)"],
  "scenes": [
    {
      "scene": "1-1",
      "location": "場所",
      "timeOfDay": "M/D/E/N/\"\"",
      "content": "要約",
      "characters": ["登場人物"],
      "props": "小道具",
      "notes": "備考"
    }
  ]
}`
    }

    console.log('Calling OpenAI API...')
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
    console.log('OpenAI response received')

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
      console.error('JSON parse error:', parseError)
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
    console.error('Unhandled error:', error)
    
    return NextResponse.json(
      { error: `サーバーエラー: ${error.message || '不明なエラー'}` },
      { status: 500 }
    )
  }
}
