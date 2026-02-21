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
type LoadingStep = 'idle' | 'uploading' | 'parsing' | 'analyzing' | 'structuring' | 'complete'

const CORRECT_PASSWORD = 'kouban2026'

export default function Home() {
  const [inputMode, setInputMode] = useState<InputMode>('file')
  const [fileType, setFileType] = useState<FileType>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [scriptText, setScriptText] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle')
  const [error, setError] = useState<string>('')
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getLoadingText = (step: LoadingStep) => {
    const texts: Record<LoadingStep, string> = {
      idle: '',
      uploading: 'ファイルをアップロード中...',
      parsing: 'ファイルを解析中...',
      analyzing: 'シーン情報を抽出中...',
      structuring: '香盤表を構築中...',
      complete: '完了',
    }
    return texts[step]
  }

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

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  const updateLoadingStep = async (step: LoadingStep) => {
    setLoadingStep(step)
    await sleep(800)
  }

  const validatePassword = () => {
    if (password !== CORRECT_PASSWORD) {
      setPasswordError('パスワードが正しくありません')
      return false
    }
    setPasswordError('')
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validatePassword()) {
      return
    }

    setError('')
    setLoadingStep('uploading')

    try {
      let payload: { pdfData?: string; docxData?: string; text?: string }

      if (inputMode === 'file') {
        if (!file) {
          setError('ファイルを選択してください')
          setLoadingStep('idle')
          return
        }
        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        )
        
        if (fileType === 'pdf') {
          payload = { pdfData: base64 }
        } else if (fileType === 'docx') {
          payload = { docxData: base64 }
        } else {
          const text = await file.text()
          payload = { text }
        }
        await updateLoadingStep('parsing')
      } else {
        if (!scriptText.trim()) {
          setError('台本テキストを入力してください')
          setLoadingStep('idle')
          return
        }
        payload = { text: scriptText }
        await updateLoadingStep('parsing')
      }

      await updateLoadingStep('analyzing')

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      await updateLoadingStep('structuring')

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '香盤表の生成に失敗しました')
      }

      const data = await response.json()

      if (!data.is_script) {
        setError(data.error_message || '台本形式ではありません')
        setLoadingStep('idle')
        return
      }

      await updateLoadingStep('complete')
      setMatrixData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました')
      setLoadingStep('idle')
    }
  }

  const handleCellEdit = useCallback((sceneIndex: number, field: keyof SceneData, value: string) => {
    if (!matrixData) return
    const newScenes = [...matrixData.scenes]
    newScenes[sceneIndex] = { ...newScenes[sceneIndex], [field]: value }
    setMatrixData({ ...matrixData, scenes: newScenes })
  }, [matrixData])

  const handleCharacterToggle = useCallback((sceneIndex: number, character: string) => {
    if (!matrixData) return
    const newScenes = [...matrixData.scenes]
    newScenes[sceneIndex] = {
      ...newScenes[sceneIndex],
      characters: {
        ...newScenes[sceneIndex].characters,
        [character]: !newScenes[sceneIndex].characters[character]
      }
    }
    setMatrixData({ ...matrixData, scenes: newScenes })
  }, [matrixData])

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
    setLoadingStep('idle')
    setSortConfig(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const isLoading = loadingStep !== 'idle' && loadingStep !== 'complete'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Ad Space Top */}
      <div className="w-full bg-gray-100 border-b border-gray-200">
        <div className="max-w-4xl mx-auto py-4 px-4">
          <div className="bg-gray-200 border-2 border-dashed border-gray-400 rounded-lg py-8 text-center">
            <p className="text-gray-500 text-sm font-medium">広告枠（Ad Space）</p>
            <p className="text-gray-400 text-xs mt-1">Google AdSense 等を設置予定</p>
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-800 mb-4">
            香盤表ジェネレーター
          </h1>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            台本（PDF/Word/テキスト）を解析し、香盤表を自動生成。CSVダウンロードも可能。長い台本も最後まで読み込みます。
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
                    <button
                      type="button"
                      onClick={() => {
                        setFileType('pdf')
                        setFile(null)
                      }}
                      className={`px-5 py-2 rounded-lg font-medium text-sm transition-all ${
                        fileType === 'pdf'
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFileType('docx')
                        setFile(null)
                      }}
                      className={`px-5 py-2 rounded-lg font-medium text-sm transition-all ${
                        fileType === 'docx'
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      Word
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFileType('txt')
                        setFile(null)
                      }}
                      className={`px-5 py-2 rounded-lg font-medium text-sm transition-all ${
                        fileType === 'txt'
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      テキスト
                    </button>
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
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-4 px-6 rounded-xl font-bold text-lg text-white transition-all
                  ${isLoading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl'
                  }`}
              >
                {isLoading ? getLoadingText(loadingStep) : '香盤表を生成'}
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

        {isLoading && (
          <div className="text-center py-12 bg-white rounded-2xl shadow-lg mb-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent mb-4"></div>
            <p className="text-slate-600 font-medium text-lg">{getLoadingText(loadingStep)}</p>
            <div className="mt-6 w-72 mx-auto bg-slate-200 rounded-full h-3">
              <div 
                className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                style={{ 
                  width: loadingStep === 'uploading' ? '20%' : 
                         loadingStep === 'parsing' ? '40%' : 
                         loadingStep === 'analyzing' ? '60%' : 
                         loadingStep === 'structuring' ? '80%' : '100%' 
                }}
              ></div>
            </div>
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
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'scene', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded"
                        >
                          {scene.scene}
                        </div>
                      </td>
                      <td className="px-4 py-3 border text-left">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'location', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded"
                        >
                          {scene.location}
                        </div>
                      </td>
                      <td className="px-2 py-3 border text-center font-medium text-slate-700">
                        {scene.timeOfDay}
                      </td>
                      <td className="px-4 py-3 border text-left">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'content', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded whitespace-pre-wrap"
                        >
                          {scene.content}
                        </div>
                      </td>
                      {matrixData.characters.map((char) => (
                        <td
                          key={char}
                          className="px-1 py-3 border text-center cursor-pointer hover:bg-blue-50"
                          onClick={() => handleCharacterToggle(index, char)}
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
                      <td className="px-4 py-3 border text-left">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'props', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded"
                        >
                          {scene.props}
                        </div>
                      </td>
                      <td className="px-4 py-3 border text-left">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'notes', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded"
                        >
                          {scene.notes}
                        </div>
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
        <div className="max-w-4xl mx-auto py-4 px-4">
          <div className="bg-gray-200 border-2 border-dashed border-gray-400 rounded-lg py-8 text-center">
            <p className="text-gray-500 text-sm font-medium">広告枠（Ad Space）</p>
            <p className="text-gray-400 text-xs mt-1">Google AdSense 等を設置予定</p>
          </div>
        </div>
      </div>
    </div>
  )
}
