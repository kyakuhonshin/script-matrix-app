import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'

export const maxDuration = 60

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// D/N判定関数
function determineDN(timeOfDay: string): string {
  if (!timeOfDay) return ''
  
  const normalized = timeOfDay.toLowerCase()
  
  // 夜判定
  if (normalized.includes('夜') || normalized.includes('深夜')) {
    return 'N'
  }
  
  // 昼判定
  if (normalized.includes('朝') || normalized.includes('昼') || 
      normalized.includes('夕') || normalized.includes('夕方') ||
      normalized.includes('午前') || normalized.includes('午後')) {
    return 'D'
  }
  
  // 該当なし
  return ''
}

// 60文字カット関数
function truncateContent(content: string, maxLength: number = 60): string {
  if (!content) return ''
  if (content.length <= maxLength) return content
  return content.substring(0, maxLength) + '...'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pdfData, docxData, text } = body

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

    // 命令型プロンプト - 指示語を含まない厳密な記述
    const systemPrompt = `Output must be in valid json format.
You are a precise screenplay parser. Extract structured data from Japanese screenplays.

EXTRACTION RULES:
1. Identify scene boundaries by looking for:
   - Lines starting with ◯ ◉ ◆ ■ ● ○
   - Lines starting with numbers followed by location (e.g., "1 オフィス", "101 廃墟")
   - Scene headers with time notations like "-夜/", "-昼/", "-夕方/"

2. For each scene, extract:
   - scene_number: The number shown in the script (preserve as-is)
   - location: The place name written in the scene header (e.g., オフィス, 路上, 公園)
   - time_of_day: Extract the EXACT time text from the header (e.g., "-夜/", "-深夜/", "-昼/", "夕方")
   - content: Summarize the scene's events using specific nouns and verbs. Be objective and concrete.
   - characters: List ALL character names that appear in this scene

3. CRITICAL: Do NOT output placeholder text like "場所名" or "内容を要約". Extract actual data from the script.

Return JSON:
{
  "is_script": true,
  "scenes": [
    {
      "scene_number": "1",
      "location": "オフィス",
      "time_of_day": "-昼/",
      "content": "主人公が書類を整理し、同僚と業務について話す",
      "characters": ["田中", "佐藤"]
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

    // 後処理：D/N判定とcontentの60文字カット
    const processedScenes = (parsedData.scenes || []).map((scene: any) => ({
      scene: scene.scene_number || String(scene.scene_number) || '',
      location: scene.location || '',
      time_of_day: scene.time_of_day || '',
      dn: determineDN(scene.time_of_day || ''),
      content: truncateContent(scene.content || '', 60),
      characters: scene.characters || [],
      props: scene.props || [],
      notes: scene.notes || ''
    }))

    return NextResponse.json({
      is_script: true,
      scenes: processedScenes
    })

  } catch (error: any) {
    return NextResponse.json(
      { error: `サーバーエラー: ${error.message || '不明なエラー'}` },
      { status: 500 }
    )
  }
}
