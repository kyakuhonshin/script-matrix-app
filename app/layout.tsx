import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '台本香盤表ジェネレーター',
  description: 'PDF台本から香盤表を自動生成',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50">{children}</body>
    </html>
  )
}
