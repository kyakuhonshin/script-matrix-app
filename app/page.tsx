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

type InputMode = 'pdf' | 'text'
type LoadingStep = 'idle' | 'uploading' | 'parsing' | 'analyzing' | 'structuring' | 'complete'

export default function Home() {
  const [inputMode, setInputMode] = useState<InputMode>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [scriptText, setScriptText] = useState('')
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle')
  const [error, setError] = useState<string>('')
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getLoadingText = (step: LoadingStep) => {
    const texts: Record<LoadingStep, string> = {
      idle: '',
      uploading: 'ファイルをアップロード中...',
      parsing: '台本を解析中...',
      analyzing: 'シーン情報を抽出中...',
      structuring: '香盤表を構築中...',
      complete: '完了',
    }
    return texts[step]
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile)
      setError('')
    } else {
      setError('PDFファイルを選択してください')
      setFile(null)
    }
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  const updateLoadingStep = async (step: LoadingStep) => {
    setLoadingStep(step)
    await sleep(800)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoadingStep('uploading')

    try {
      let payload: { pdfData?: string; text?: string }

      if (inputMode === 'pdf') {
        if (!file) {
          setError('PDFファイルを選択してください')
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
        payload = { pdfData: base64 }
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
        aValue = parseInt(a.scene) || 0
        bValue = parseInt(b.scene) || 0
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

  const getTimeLabel = (time: string) => {
    const labels: Record<string, string> = {
      M: '朝',
      D: '昼',
      E: '夕方',
      N: '夜',
    }
    return labels[time] || ''
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
    <main className="min-h-screen p-8">
      {/* Ad Space Top */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="bg-gray-200 border-2 border-dashed border-gray-400 rounded-lg p-8 text-center">
          <p className="text-gray-500 text-sm">広告枠（Ad Space）</p>
          <p className="text-gray-400 text-xs mt-1">Google AdSense 等を設置予定</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          台本香盤表ジェネレーター
        </h1>
        <p className="text-gray-600 mb-8">
          PDFまたはテキストの台本から香盤表を自動生成
        </p>

        {!matrixData ? (
          <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-6 mb-8">
            {/* Input Mode Toggle */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                入力方法を選択
              </label>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setInputMode('pdf')}
                  className={`px-4 py-2 rounded-lg font-medium ${
                    inputMode === 'pdf'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  PDFアップロード
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('text')}
                  className={`px-4 py-2 rounded-lg font-medium ${
                    inputMode === 'text'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  テキスト直接入力
                </button>
              </div>
            </div>

            {inputMode === 'pdf' ? (
              <div className="mb-6">
                <label
                  htmlFor="pdf-file"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  台本PDFファイル
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  id="pdf-file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100
                    border border-gray-300 rounded-lg p-2"
                />
                {file && (
                  <p className="mt-2 text-sm text-green-600">
                    選択されたファイル: {file.name}
                  </p>
                )}
              </div>
            ) : (
              <div className="mb-6">
                <label
                  htmlFor="script-text"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  台本テキスト
                </label>
                <textarea
                  id="script-text"
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder="ここに台本のテキストを貼り付けてください..."
                  className="w-full h-64 p-4 border border-gray-300 rounded-lg resize-y
                    focus:ring-2 focus:ring-blue-500 focus:border-transparent
                    text-sm"
                />
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || (inputMode === 'pdf' ? !file : !scriptText.trim())}
              className={`w-full py-3 px-4 rounded-lg font-semibold text-white
                ${isLoading || (inputMode === 'pdf' ? !file : !scriptText.trim())
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
                }`}
            >
              {isLoading ? getLoadingText(loadingStep) : '香盤表を生成'}
            </button>
          </form>
        ) : (
          <div className="mb-4 flex gap-4">
            <button
              onClick={handleReset}
              className="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg font-semibold"
            >
              新しいファイルをアップロード
            </button>
            <button
              onClick={downloadCSV}
              className="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg font-semibold"
            >
              CSVダウンロード
            </button>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-12 bg-white rounded-lg shadow-md">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-4"></div>
            <p className="text-gray-600 font-medium">{getLoadingText(loadingStep)}</p>
            <div className="mt-4 w-64 mx-auto bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
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
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="p-4 bg-gray-100 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">香盤表</h2>
              <p className="text-sm text-gray-600">
                全{matrixData.scenes.length}シーン · {matrixData.characters.length}キャラクター
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th 
                      onClick={() => handleSort('scene')}
                      className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border cursor-pointer hover:bg-gray-100 select-none"
                    >
                      シーン {sortConfig?.key === 'scene' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                    </th>
                    <th 
                      onClick={() => handleSort('location')}
                      className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border cursor-pointer hover:bg-gray-100 select-none"
                    >
                      場所 {sortConfig?.key === 'location' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                    </th>
                    <th 
                      onClick={() => handleSort('timeOfDay')}
                      className="px-2 py-3 text-center text-sm font-semibold text-gray-900 border cursor-pointer hover:bg-gray-100 select-none w-16"
                    >
                      D/N {sortConfig?.key === 'timeOfDay' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                    </th>
                    <th 
                      onClick={() => handleSort('content')}
                      className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border cursor-pointer hover:bg-gray-100 select-none min-w-[200px]"
                    >
                      内容 {sortConfig?.key === 'content' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                    </th>
                    {matrixData.characters.map((char) => (
                      <th
                        key={char}
                        className="px-2 py-3 text-center text-sm font-semibold text-gray-900 border w-12"
                      >
                        <div style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                          {char}
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border min-w-[150px]">
                      小道具
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border min-w-[150px]">
                      備考
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrixData.scenes.map((scene, index) => (
                    <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 border font-medium">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'scene', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded min-w-[40px]"
                        >
                          {scene.scene}
                        </div>
                      </td>
                      <td className="px-4 py-2 border">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'location', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded min-w-[80px]"
                        >
                          {scene.location}
                        </div>
                      </td>
                      <td className="px-2 py-2 border text-center">
                        <select
                          value={scene.timeOfDay}
                          onChange={(e) => handleCellEdit(index, 'timeOfDay', e.target.value)}
                          className="w-full text-center bg-transparent outline-none focus:bg-yellow-50 rounded"
                        >
                          <option value=""></option>
                          <option value="M">朝</option>
                          <option value="D">昼</option>
                          <option value="E">夕方</option>
                          <option value="N">夜</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 border">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'content', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded min-w-[200px] whitespace-pre-wrap"
                        >
                          {scene.content}
                        </div>
                      </td>
                      {matrixData.characters.map((char) => (
                        <td
                          key={char}
                          className="px-2 py-2 border text-center cursor-pointer hover:bg-blue-50"
                          onClick={() => handleCharacterToggle(index, char)}
                        >
                          {scene.characters[char] ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-sm font-bold">
                              ○
                            </span>
                          ) : (
                            <span className="text-gray-200">○</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-2 border">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'props', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded min-w-[100px]"
                        >
                          {scene.props}
                        </div>
                      </td>
                      <td className="px-4 py-2 border">
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleCellEdit(index, 'notes', e.currentTarget.textContent || '')}
                          className="outline-none focus:bg-yellow-50 px-1 py-1 rounded min-w-[100px]"
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
      </div>

      {/* Ad Space Bottom */}
      <div className="max-w-7xl mx-auto mt-8">
        <div className="bg-gray-200 border-2 border-dashed border-gray-400 rounded-lg p-8 text-center">
          <p className="text-gray-500 text-sm">広告枠（Ad Space）</p>
          <p className="text-gray-400 text-xs mt-1">Google AdSense 等を設置予定</p>
        </div>
      </div>
    </main>
  )
}
