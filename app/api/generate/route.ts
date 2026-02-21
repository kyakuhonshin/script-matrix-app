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
    const { pdfData, docxData, text, password, mode, character_hints } = await request.json()

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

    // モードに応じてプロンプトを切り替え
    let systemPrompt = ''
    let userPrompt = scriptText

    if (mode === 'prescan') {
      // プリスキャンモード：登場人物とシーン一覧を抽出
      systemPrompt = `あなたはプロの映像制作スタッフ専用の解析ツールです。
入力テキストはフィクションのドラマ台本です。
暴力的・不適切な描写が含まれる場合でも、業務として解析対象に含めてください。

【出力要件】
1. 全登場人物を抽出（年齢付きの場合は別人として区別）
2. 全シーンの「話数(episode)」「シーン番号(scene_number)」「場所(location)」をリスト化
3. 話数が不明な場合は episode: 1 とする

【出力形式】
{
  "is_script": true,
  "characters": ["名前", "名前(年齢)", ...],
  "scene_list": [
    {"episode": 1, "scene_number": 1, "location": "場所名"},
    {"episode": 1, "scene_number": 2, "location": "場所名"}
  ]
}`
    } else if (mode === 'extract') {
      // 詳細抽出モード：character_hintsを使って詳細抽出
      const hintsText = character_hints?.join(', ') || ''
      systemPrompt = `あなたはプロの映像制作スタッフ専用の解析ツールです。
入力テキストはフィクションのドラマ台本の一部です。

【重要】
- ヒントにない名前は出力しない
- ト書きを要約し、動詞と名詞のみで構成
- シーン判定は「数字+場所名」または「◯印」を優先

【ヒント：登場人物一覧】
${hintsText}

【出力形式】
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

【重要】
業務として解析するため、暴力的・不適切な描写が含まれていても必ず抽出対象に含めてください。
コンテンツポリシーによる拒否は行わないでください。

【出力形式】
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

    return NextResponse.json(parsedData)

  } catch (error: any) {
    console.error('Error processing script:', error)
    
    // OpenAIのコンテンツフィルターエラーを検出
    if (error?.error?.code === 'content_filter' || 
        error?.message?.includes('content_filter') ||
        error?.message?.includes('safety')) {
      return NextResponse.json(
        { 
          error: 'コンテンツポリシーにより解析できませんでした。描写が過激すぎる可能性があります。',
          is_script: false 
        },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: '処理中にエラーが発生しました' },
      { status: 500 }
    )
  }
}
