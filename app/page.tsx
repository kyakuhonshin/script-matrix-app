'use client'

import { useState, useRef } from 'react'

interface SceneData {
  scene: string
  location: string
  timeOfDay: string
  content: string
  characters: Record<string, boolean>
  props: string
  notes: string
}

interface MatrixData {
  characters: string[]
  scenes: SceneData[]
}

type FileType = 'pdf' | 'docx' | 'txt'

const CHUNK_SIZE = 8000

// D/Nを日本語に変換
function getTimeLabel(code: string): string {
  const labels: Record<string, string> = {
    'N': '夜',
    'D': '昼',
  }
  return labels[code] || code
}

// テキストを分割
function splitTextIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = []
  let position = 0
  
  while (position < text.length) {
    const end = Math.min(position + chunkSize, text.length)
    chunks.push(text.slice(position, end))
    position = end
  }
  
  return chunks
}

export default function Home() {
  const [fileType, setFileType] = useState<FileType>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, filename: '' })
  const [error, setError] = useState<string>('')
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getFileAccept = () => {
    switch (fileType) {
      case 'pdf': return '.pdf'
      case 'docx': return '.docx'
      case 'txt': return '.txt'
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    const validTypes: Record<FileType, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain'
    }

    if (fileType === 'txt' || selectedFile.type === validTypes[fileType] || 
        (fileType === 'docx' && selectedFile.name.endsWith('.docx'))) {
      setFile(selectedFile)
      setError('')
    } else {
      setError('適切なファイル形式を選択してください')
      setFile(null)
    }
  }

  const handleFileSelectClick = () => {
    fileInputRef.current?.click()
  }

  // 直列処理
  const processTextSequentially = async (fullText: string, filename: string): Promise<MatrixData> => {
    const chunks = splitTextIntoChunks(fullText, CHUNK_SIZE)
    const totalChunks = chunks.length
    
    setProgress({ current: 0, total: totalChunks, filename })
    
    const allScenes: any[] = []
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunk }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`セクション ${i + 1} の処理に失敗: ${errorText}`)
        }

        const data = await response.json()
        
        if (!data.is_script) {
          throw new Error(data.error_message || '台本形式ではありません')
        }

        if (data.scenes && Array.isArray(data.scenes)) {
          allScenes.push(...data.scenes)
        }
        
        setProgress({ current: i + 1, total: totalChunks, filename })
        
      } catch (err: any) {
        console.error(`Chunk ${i + 1} failed:`, err)
      }
    }
    
    if (allScenes.length === 0) {
      throw new Error('処理に失敗しました')
    }
    
    // 登場人物を収集
    const allCharacters = new Set<string>()
    for (const scene of allScenes) {
      if (scene.characters && Array.isArray(scene.characters)) {
        for (const char of scene.characters) {
          allCharacters.add(char)
        }
      }
    }
    const sortedCharacters = Array.from(allCharacters).sort()
    
    // シーンデータを整形
    const processedScenes = allScenes.map((scene: any) => ({
      scene: scene.episode && scene.episode !== '1' 
        ? `${scene.episode}-${scene.scene}` 
        : scene.scene,
      location: scene.location || '',
      timeOfDay: scene.dn || '',
      content: scene.content || '',
      characters: sortedCharacters.reduce((acc, char) => {
        const isPresent = scene.characters?.includes(char) || false
        acc[char] = isPresent
        return acc
      }, {} as Record<string, boolean>),
      props: Array.isArray(scene.props) ? scene.props.join(', ') : (scene.props || ''),
      notes: scene.notes || ''
    }))
    
    return {
      characters: sortedCharacters,
      scenes: processedScenes
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsProcessing(true)

    try {
      if (!file) {
        setError('ファイルを選択してください')
        setIsProcessing(false)
        return
      }
      
      // TXTファイルの場合はチャンク処理
      if (fileType === 'txt') {
        const text = await file.text()
        const result = await processTextSequentially(text, file.name)
        setMatrixData(result)
        setIsProcessing(false)
        return
      }
      
      // PDF/DOCXはそのまま送信
      const arrayBuffer = await file.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ''
        )
      )
      
      const payload = fileType === 'pdf' 
        ? { pdfData: base64 }
        : { docxData: base64 }
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ファイル解析エラー: ${errorText}`)
      }

      const data = await response.json()
      
      if (!data.is_script) {
        setError(data.error_message || '台本形式ではありません')
        setIsProcessing(false)
        return
      }

      // 登場人物を収集
      const allScenes = data.scenes || []
      const allCharacters = new Set<string>()
      for (const scene of allScenes) {
        if (scene.characters && Array.isArray(scene.characters)) {
          for (const char of scene.characters) {
            allCharacters.add(char)
          }
        }
      }
      const sortedCharacters = Array.from(allCharacters).sort()
      
      const processedScenes = allScenes.map((scene: any) => ({
        scene: scene.episode && scene.episode !== '1' 
          ? `${scene.episode}-${scene.scene}` 
          : scene.scene,
        location: scene.location || '',
        timeOfDay: scene.dn || '',
        content: scene.content || '',
        characters: sortedCharacters.reduce((acc, char) => {
          const isPresent = scene.characters?.includes(char) || false
          acc[char] = isPresent
          return acc
        }, {} as Record<string, boolean>),
        props: Array.isArray(scene.props) ? scene.props.join(', ') : (scene.props || ''),
        notes: scene.notes || ''
      }))

      setMatrixData({
        characters: sortedCharacters,
        scenes: processedScenes
      })
      
    } catch (err: any) {
      console.error('Processing error:', err)
      const errorMsg = err.message || '予期しないエラーが発生しました'
      setError(errorMsg)
      
      if (errorMsg.includes('TIMEOUT') || errorMsg.includes('FUNCTION_INVOCATION_TIMEOUT') || 
          errorMsg.includes('504') || errorMsg.includes('60秒')) {
        setError(errorMsg + '\n\nデータ量が多いため処理がタイムアウトしました。PDFを話数ごとに分割してアップロードすると解決する可能性があります。')
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const downloadCSV = () => {
    if (!matrixData) return

    const headers = ['シーン', '場所', 'D/N', '内容', ...matrixData.characters, '小道具', '備考']
    
    const rows = matrixData.scenes.map(scene => [
      scene.scene,
      scene.location,
      getTimeLabel(scene.timeOfDay),
      scene.content,
      ...matrixData.characters.map(char => scene.characters[char] ? '○' : ''),
      scene.props,
      scene.notes
    ])

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const bom = '\uFEFF'
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `香盤表_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setFile(null)
    setMatrixData(null)
    setError('')
    setIsProcessing(false)
    setProgress({ current: 0, total: 0, filename: '' })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Ad Space Top */}
      <div className="w-full bg-gray-100 border-b border-gray-200">
        <div className="max-w-5xl mx-auto py-4 px-4">
          <div className="bg-gray-200 border-2 border-dashed border-gray-400 rounded-lg py-8 text-center">
            <p className="text-gray-500 text-sm font-medium">広告枠（Ad Space）</p>
            <p className="text-gray-400 text-xs mt-1">Google AdSense 等を設置予定</p>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-800 mb-4">
            香盤表ジェネレーター v2.10
          </h1>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto whitespace-pre-line">
            アップロードするファイル形式を選んで、ファイルを選択してアップロードしてください。
            {'\n'}生成には1分程度の時間がかかります。
            {'\n'}生成後はcsvでダウンロードできるので、スプレッドシートに貼り付けてください。
            {'\n'}PDFは1度に20ページまでにしてください。20ページを超える場合は、PDFを分割してアップロードしてください。
          </p>
        </div>

        {!matrixData ? (
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-8">
            <form onSubmit={handleSubmit}>
              <div className="mb-8 p-6 bg-gray-50 border border-gray-200 rounded-xl">
                <label className="block text-sm font-semibold text-slate-700 mb-4">
                  ファイル形式を選択する
                </label>
                <div className="flex gap-3 mb-6">
                  {(['pdf', 'docx', 'txt'] as FileType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setFileType(type)
                        setFile(null)
                      }}
                      className={`px-5 py-2 rounded-lg font-medium text-sm transition-all ${
                        fileType === type
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {type === 'pdf' && 'PDF'}
                      {type === 'docx' && 'Word'}
                      {type === 'txt' && 'テキスト'}
                    </button>
                  ))}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={getFileAccept()}
                  onChange={handleFileChange}
                  className="hidden"
                />
                
                <button
                  type="button"
                  onClick={handleFileSelectClick}
                  className="w-full py-4 px-6 bg-white border-2 border-dashed border-blue-400 rounded-xl text-blue-600 font-semibold hover:bg-blue-50 hover:border-blue-500 transition-all"
                >
                  {file ? `✓ ${file.name}` : 'ファイルを選択'}
                </button>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-700 font-medium">⚠ {error}</p>
                  {(error.includes('TIMEOUT') || error.includes('504') || error.includes('60秒')) && (
                    <p className="mt-2 text-red-600 text-sm">
                      データ量が多いため処理がタイムアウトしました。PDFを話数ごとに分割してアップロードすると解決する可能性があります。
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isProcessing}
                className={`w-full py-4 px-6 rounded-xl font-bold text-lg text-white transition-all
                  ${isProcessing
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl'
                  }`}
              >
                {isProcessing ? `処理中 (${progress.current}/${progress.total})` : '香盤表を生成'}
              </button>
            </form>
          </div>
        ) : (
          <div className="mb-8 flex gap-4 justify-center">
            <button
              onClick={handleReset}
              className="bg-slate-600 hover:bg-slate-700 text-white py-3 px-6 rounded-xl font-semibold shadow-lg transition-all"
            >
              新しいファイルをアップロード
            </button>
            <button
              onClick={downloadCSV}
              className="bg-green-600 hover:bg-green-700 text-white py-3 px-6 rounded-xl font-semibold shadow-lg transition-all"
            >
              CSVダウンロード
            </button>
          </div>
        )}

        {isProcessing && (
          <div className="text-center py-12 bg-white rounded-2xl shadow-lg mb-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent mb-4"></div>
            <p className="text-slate-600 font-medium text-lg">
              {progress.filename ? `${progress.filename} を読み込み中...` : '処理中...'}
            </p>
            {progress.total > 0 && (
              <p className="text-slate-500 text-sm mt-2">
                ({progress.current}/{progress.total})
              </p>
            )}
            {progress.total > 0 && (
              <div className="mt-4 w-72 mx-auto bg-slate-200 rounded-full h-3">
                <div 
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
              </div>
            )}
          </div>
        )}

        {matrixData && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-800">香盤表</h2>
              <p className="text-sm text-slate-600 font-medium">
                全{matrixData.scenes.length}シーン · {matrixData.characters.length}キャラクター
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="px-3 py-4 text-center text-sm font-bold text-slate-800 border w-16">
                      シーン
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-slate-800 border">
                      場所
                    </th>
                    <th className="px-2 py-4 text-center text-sm font-bold text-slate-800 border w-12">
                      D/N
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-slate-800 border min-w-[300px]">
                      内容
                    </th>
                    {matrixData.characters.map((char) => (
                      <th
                        key={char}
                        className="px-1 py-4 text-center text-xs font-bold text-slate-800 border w-10"
                      >
                        <div className="whitespace-nowrap" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                          {char}
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-4 text-left text-sm font-bold text-slate-800 border min-w-[120px]">
                      小道具
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-bold text-slate-800 border min-w-[100px]">
                      備考
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrixData.scenes.map((scene, index) => (
                    <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-3 py-3 border text-center font-bold text-slate-700">
                        {scene.scene}
                      </td>
                      <td className="px-4 py-3 border text-left text-slate-700">
                        {scene.location}
                      </td>
                      <td className="px-2 py-3 border text-center font-medium text-slate-700">
                        {getTimeLabel(scene.timeOfDay)}
                      </td>
                      <td className="px-4 py-3 border text-left text-slate-700 whitespace-pre-wrap">
                        {scene.content}
                      </td>
                      {matrixData.characters.map((char) => (
                        <td
                          key={char}
                          className="px-1 py-3 border text-center"
                        >
                          {scene.characters[char] ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold">
                              ○
                            </span>
                          ) : (
                            <span className="text-slate-200">○</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3 border text-left text-slate-700">
                        {scene.props}
                      </td>
                      <td className="px-4 py-3 border text-left text-slate-700">
                        {scene.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Ad Space Bottom */}
      <div className="w-full bg-gray-100 border-t border-gray-200 mt-12">
        <div className="max-w-5xl mx-auto py-4 px-4">
          <div className="bg-gray-200 border-2 border-dashed border-gray-400 rounded-lg py-8 text-center">
            <p className="text-gray-500 text-sm font-medium">広告枠（Ad Space）</p>
            <p className="text-gray-400 text-xs mt-1">Google AdSense 等を設置予定</p>
          </div>
        </div>
      </div>
    </div>
  )
}
