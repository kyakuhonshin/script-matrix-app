'use client'

import { useState, useRef } from 'react'

interface SceneData {
  scene: string
  location: string
  timeOfDay: 'M' | 'D' | 'E' | 'N'
  content: string
  characters: Record<string, boolean>
  props: string
  notes: string
}

interface MatrixData {
  characters: string[]
  scenes: SceneData[]
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      setError('ファイルを選択してください')
      return
    }

    setLoading(true)
    setError('')

    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ''
        )
      )

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pdfData: base64 }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '香盤表の生成に失敗しました')
      }

      const data = await response.json()
      setMatrixData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const getTimeLabel = (time: string) => {
    const labels: Record<string, string> = {
      M: '朝',
      D: '昼',
      E: '夕方',
      N: '夜',
    }
    return labels[time] || time
  }

  const handleReset = () => {
    setFile(null)
    setMatrixData(null)
    setError('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          台本香盤表ジェネレーター
        </h1>
        <p className="text-gray-600 mb-8">
          PDF台本をアップロードして、香盤表を自動生成します
        </p>

        {!matrixData ? (
          <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="mb-4">
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

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !file}
              className={`w-full py-3 px-4 rounded-lg font-semibold text-white
                ${loading || !file
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
                }`}
            >
              {loading ? '生成中...' : '香盤表を生成'}
            </button>
          </form>
        ) : (
          <div className="mb-4">
            <button
              onClick={handleReset}
              className="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg font-semibold"
            >
              新しいファイルをアップロード
            </button>
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">台本を解析中...</p>
          </div>
        )}

        {matrixData && (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="p-4 bg-gray-100 border-b">
              <h2 className="text-xl font-bold text-gray-900">香盤表</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b sticky left-0 bg-gray-50 z-10">
                      シーン
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b">
                      場所
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-900 border-b w-16">
                      D/N
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b min-w-[200px]">
                      内容
                    </th>
                    {matrixData.characters.map((char) => (
                      <th
                        key={char}
                        className="px-2 py-3 text-center text-sm font-semibold text-gray-900 border-b w-12"
                      >
                        <div className="writing-vertical text-xs" style={{ writingMode: 'vertical-rl' }}>
                          {char}
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b min-w-[150px]">
                      小道具
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 border-b min-w-[150px]">
                      備考
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrixData.scenes.map((scene, index) => (
                    <tr
                      key={index}
                      className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 border-b sticky left-0 bg-inherit z-10 font-medium">
                        {scene.scene}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border-b">
                        {scene.location}
                      </td>
                      <td className="px-2 py-3 text-center text-sm text-gray-700 border-b">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-800 text-xs font-semibold">
                          {getTimeLabel(scene.timeOfDay)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border-b">
                        {scene.content}
                      </td>
                      {matrixData.characters.map((char) => (
                        <td
                          key={char}
                          className="px-2 py-3 text-center border-b"
                        >
                          {scene.characters[char] ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-sm font-bold">
                              ○
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-sm text-gray-700 border-b">
                        {scene.props}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border-b">
                        {scene.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
