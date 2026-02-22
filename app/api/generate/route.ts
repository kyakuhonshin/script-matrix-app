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
  return content.slice(0, maxLength) + '...'
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

    // 単純なプロンプト - time_of_dayを文字列で抽出、contentは厳密に短く
    const systemPrompt = `Output must be in valid json format.
You are a film production script analysis AI.
Extract ALL scenes from the Japanese screenplay without omission.

CRITICAL RULES:
1. Extract EVERY scene from the script, do not stop at scene 10
2. Preserve the original scene numbers from the script in "scene_number" field
3. For "time_of_day", extract the EXACT time text from the script (e.g., "-夜/", "-昼/", "夕方", "深夜", "朝"). Do NOT convert to D/N.
4. For "content", write EXACTLY 1 sentence, MAXIMUM 60 characters including punctuation. Only 1 period allowed.
5. Include ALL characters that appear in each scene

Return JSON:
{
  "is_script": true,
  "scenes": [
    {
      "scene_number": "1",
      "episode": "1",
      "location": "場所名",
      "time_of_day": "-夜/",
      "content": "シーン内容を一文で60文字以内に要約",
      "characters": ["椿", "トシ", "音部"],
      "props": ["小道具1"]
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
      scene: scene.scene_number || scene.scene || '',
      episode: scene.episode || '1',
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
