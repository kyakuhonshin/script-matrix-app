'use client'

import { useState, useRef, useCallback } from 'react'

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

type InputMode = 'file' | 'text'
type FileType = 'pdf' | 'docx' | 'txt'

const CORRECT_PASSWORD = 'kouban2026'
const CHUNK_SIZE = 8000

// D/Nを日本語に変換
function getTimeLabel(code: string): string {
  const labels: Record<string, string> = {
    'M': '朝',
    'D': '昼',
    'E': '夕方',
    'N': '夜',
  }
  return labels[code] || code
}

// テキストを分割（単純にチャンク化）
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
  const [inputMode, setInputMode] = useState<InputMode>('file')
  const [fileType, setFileType] = useState<FileType>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [scriptText, setScriptText] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState<string>('')
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
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

  const validatePassword = () => {
    if (password !== CORRECT_PASSWORD) {
      setPasswordError('パスワードが正しくありません')
      return false
    }
    setPasswordError('')
    return true
  }

  // 直列処理（シーケンシャル）- タイムアウト回避のため
  const processTextSequentially = async (fullText: string): Promise<MatrixData> => {
    const chunks = splitTextIntoChunks(fullText, CHUNK_SIZE)
    const totalChunks = chunks.length
    
    setProgress({ current: 0, total: totalChunks })
    
    const allScenes: any[] = []
    
    // 直列処理：1つずつ順番に処理
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            text: chunk, 
            password
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`セクション ${i + 1} の処理に失敗: ${errorText}`)
        }

        const data = await response.json()
        
        if (!data.is_script) {
          throw new Error(data.error_message || '台本形式ではありません')
        }

        // シーンを追加
        if (data.scenes && Array.isArray(data.scenes)) {
          allScenes.push(...data.scenes)
        }
        
        // 進捗更新
        setProgress({ current: i + 1, total: totalChunks })
        
      } catch (err: any) {
        console.error(`Chunk ${i + 1} failed:`, err)
        // エラーが出ても続行（部分的な結果を返す）
      }
    }
    
    // すべてのシーンからユニークな登場人物を収集
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
    const processedScenes = allScenes.map((scene: any, index: number) => ({
      scene: scene.scene_number || scene.scene || String(index + 1),
      location: scene.location || '',
      timeOfDay: scene.dn || scene.timeOfDay || '',
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
    
    if (!validatePassword()) {
      return
    }

    setError('')
    setIsProcessing(true)

    try {
      // ファイルアップロードの場合は単純に1回のAPIコール
      if (inputMode === 'file') {
        if (!file) {
          setError('ファイルを選択してください')
          setIsProcessing(false)
          return
        }
        
        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        )
        
        const payload = fileType === 'pdf' 
          ? { pdfData: base64, password }
          : { docxData: base64, password }
        
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

        // 単一レスポンスから登場人物を収集
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
        
        const processedScenes = allScenes.map((scene: any, index: number) => ({
          scene: scene.scene_number || scene.scene || String(index + 1),
          location: scene.location || '',
          timeOfDay: scene.dn || scene.timeOfDay || '',
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
        setIsProcessing(false)
        return
      }
      
      // テキスト入力の場合
      if (!scriptText.trim()) {
        setError('台本テキストを入力してください')
        setIsProcessing(false)
        return
      }
      
      // 長いテキストは直列処理（タイムアウト回避）
      const result = await processTextSequentially(scriptText)
      setMatrixData(result)
      
    } catch (err: any) {
      console.error('Processing error:', err)
      const errorMsg = err.message || '予期しないエラーが発生しました'
      setError(errorMsg)
      
      // タイムアウトエラーの場合はアドバイスを表示
      if (errorMsg.includes('TIMEOUT') || errorMsg.includes('FUNCTION_INVOCATION_TIMEOUT') || 
          errorMsg.includes('504') || errorMsg.includes('60秒')) {
        setError(errorMsg + '\n\nデータ量が多いため処理がタイムアウトしました。PDFを話数ごとに分割してアップロードすると解決する可能性があります。')
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSort = (key: string) => {
    if (!matrixData) return
    
    let direction: 'asc' | 'desc' = 'asc'
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })

    const sortedScenes = [...matrixData.scenes].sort((a, b) => {
      let aValue: string | number
      let bValue: string | number

      if (key === 'scene') {
        aValue = a.scene
        bValue = b.scene
      } else if (key === 'timeOfDay') {
        const order = { 'M': 0, 'D': 1, 'E': 2, 'N': 3, '': 4 }
        aValue = order[a.timeOfDay as keyof typeof order] ?? 5
        bValue = order[b.timeOfDay as keyof typeof order] ?? 5
      } else {
        aValue = (a[key as keyof SceneData] as string)?.toLowerCase() || ''
        bValue = (b[key as keyof SceneData] as string)?.toLowerCase() || ''
      }

      if (aValue < bValue) return direction === 'asc' ? -1 : 1
      if (aValue > bValue) return direction === 'asc' ? 1 : -1
      return 0
    })

    setMatrixData({ ...matrixData, scenes: sortedScenes })
  }

  const downloadCSV = () => {
    if (!matrixData) return

    const headers = ['シーン', '場所', 'D/N', '内容', ...matrixData.characters, '小道具', '備考']
    
    const rows = matrixData.scenes.map(scene => [
      scene.scene,
      scene.location,
      scene.timeOfDay,
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
    setScriptText('')
    setMatrixData(null)
    setError('')
    setIsProcessing(false)
    setProgress({ current: 0, total: 0 })
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
            香盤表ジェネレーター
          </h1>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            台本（PDF/Word/テキスト）を解析し、香盤表を自動生成。全シーンを漏らさず抽出します。
          </p>
        </div>

        {!matrixData ? (
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-8">
            {/* Password Input */}
            <div className="mb-8">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPasswordError('')
                }}
                placeholder="パスワードを入力"
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {passwordError && (
                <p className="mt-2 text-red-600 text-sm font-medium">{passwordError}</p>
              )}
            </div>

            {/* Input Mode Tabs */}
            <div className="mb-8">
              <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setInputMode('file')}
                  className={`flex-1 py-3 px-6 rounded-lg font-medium transition-all ${
                    inputMode === 'file'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  ファイルから
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('text')}
                  className={`flex-1 py-3 px-6 rounded-lg font-medium transition-all ${
                    inputMode === 'text'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  テキスト入力
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              {inputMode === 'file' && (
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
                  
                  <p className="mt-4 text-sm text-slate-500">
                    ※ PDFは1度に20ページまでにしてください。20ページを超える場合は、話数ごとにPDFを分割してアップロードしてください。
                  </p>
                </div>
              )}

              {inputMode === 'text' && (
                <div className="mb-8">
                  <label
                    htmlFor="script-text"
                    className="block text-sm font-semibold text-slate-700 mb-3"
                  >
                    台本テキスト
                  </label>
                  <textarea
                    id="script-text"
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder="ここに台本のテキストを貼り付けてください..."
                    className="w-full h-64 p-4 border border-slate-300 rounded-xl resize-y
                      focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      text-sm"
                  />
                </div>
              )}

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
              {progress.total > 0 ? `処理中... (${progress.current}/${progress.total})` : '処理中...'}
            </p>
            {progress.total > 0 && (
              <div className="mt-6 w-72 mx-auto bg-slate-200 rounded-full h-3">
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
                    <th 
                      onClick={() => handleSort('scene')}
                      className="px-3 py-4 text-center text-sm font-bold text-slate-800 border cursor-pointer hover:bg-slate-200 select-none"
                    >
                      シーン {sortConfig?.key === 'scene' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                    </th>
                    <th 
                      onClick={() => handleSort('location')}
                      className="px-4 py-4 text-left text-sm font-bold text-slate-800 border cursor-pointer hover:bg-slate-200 select-none"
                    >
                      場所 {sortConfig?.key === 'location' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                    </th>
                    <th 
                      onClick={() => handleSort('timeOfDay')}
                      className="px-2 py-4 text-center text-sm font-bold text-slate-800 border cursor-pointer hover:bg-slate-200 select-none w-14"
                    >
                      D/N {sortConfig?.key === 'timeOfDay' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                    </th>
                    <th 
                      onClick={() => handleSort('content')}
                      className="px-4 py-4 text-left text-sm font-bold text-slate-800 border cursor-pointer hover:bg-slate-200 select-none min-w-[200px]"
                    >
                      内容 {sortConfig?.key === 'content' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
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
                    <th className="px-4 py-4 text-left text-sm font-bold text-slate-800 border min-w-[120px]">
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
