import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface SceneData {
  scene: string
  location: string
  timeOfDay: 'M' | 'D' | 'E' | 'N'
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
    const { pdfData } = await request.json()

    if (!pdfData) {
      return NextResponse.json(
        { error: 'PDFデータが提供されていません' },
        { status: 400 }
      )
    }

    // Base64デコードしてPDFパース
    const buffer = Buffer.from(pdfData, 'base64')
    const pdfResult = await pdfParse(buffer)
    const scriptText = pdfResult.text

    if (!scriptText || scriptText.trim().length === 0) {
      return NextResponse.json(
        { error: 'PDFからテキストを抽出できませんでした' },
        { status: 400 }
      )
    }

    // テキストが長すぎる場合は切り詰め
    const maxLength = 15000
    const truncatedText = scriptText.length > maxLength
      ? scriptText.substring(0, maxLength) + '...'
      : scriptText

    // OpenAI APIで台本解析
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `あなたは映画・ドラマの台本解析専門家です。
台本テキストを解析し、以下のJSON形式で香盤表データを生成してください。

出力形式:
{
  "characters": ["キャラクター名1", "キャラクター名2", ...],
  "scenes": [
    {
      "scene": "シーン番号（例：1, 2, 3）",
      "location": "場所の名称",
      "timeOfDay": "M/D/E/Nのいずれか（朝=Morning=M, 昼=Day=D, 夕方=Evening=E, 夜=Night=N）",
      "content": "シーン内容の要約（1-2文）",
      "characters": ["登場するキャラクター名の配列"],
      "props": "使用される小道具（カンマ区切り、ない場合は空文字）",
      "notes": "備考（ない場合は空文字）"
    }
  ]
}

注意事項:
1. シーンは台本内の場面転換ごとに分けてください
2. 全キャラクターを抽出し、characters配列に含めてください
3. 各シーンに登場するキャラクターを正確に記録してください
4. timeOfDayは明示されていない場合は内容から推測してください
5. 有効なJSONのみを出力してください（マークダウン記法は不要）`
        },
        {
          role: 'user',
          content: `以下の台本を解析して香盤表JSONを生成してください：\n\n${truncatedText}`
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })

    const content = completion.choices[0]?.message?.content

    if (!content) {
      return NextResponse.json(
        { error: 'OpenAI APIからの応答が空でした' },
        { status: 500 }
      )
    }

    // JSONパース
    let parsedData: ParsedScript
    try {
      parsedData = JSON.parse(content)
    } catch (parseError) {
      return NextResponse.json(
        { error: 'OpenAI APIの応答をJSONとしてパースできませんでした' },
        { status: 500 }
      )
    }

    // レスポンス用にデータ整形
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
