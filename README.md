# 台本香盤表ジェネレーター

映画・ドラマの台本PDFから香盤表を自動生成するWebアプリケーション。

## 技術スタック

- **フレームワーク**: Next.js 14 (App Router)
- **スタイリング**: Tailwind CSS
- **デプロイ**: Vercel
- **LLM**: OpenAI API (gpt-4o)

## 機能

- PDF台本のアップロード
- OpenAI APIによる自動解析
- 香盤表のマトリックス表示（横スクロール対応）
- 登場人物の動的カラム表示

## ローカル開発

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd script-matrix-app
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.local`ファイルを作成し、OpenAI APIキーを設定：

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開く。

## Vercelへのデプロイ

### 1. Vercel CLIのインストール（未インストールの場合）

```bash
npm i -g vercel
```

### 2. Vercelへのログイン

```bash
vercel login
```

### 3. プロジェクトのデプロイ

```bash
vercel
```

初回デプロイ時にプロジェクト設定を行います。

### 4. 環境変数の設定

Vercel Dashboardから、プロジェクトの「Settings」→「Environment Variables」で
`OPENAI_API_KEY`を設定してください。

### または、CLIから設定

```bash
vercel env add OPENAI_API_KEY
```

その後、再デプロイ：

```bash
vercel --prod
```

## 使用方法

1. トップページで台本PDFファイルを選択
2. 「香盤表を生成」ボタンをクリック
3. 解析完了後、香盤表がマトリックス形式で表示される
4. 横スクロールで全キャラクターの登場状況を確認可能

## データ構造

生成される香盤表は以下のカラムを持ちます：

- **シーン**: シーン番号
- **場所**: 撮影場所
- **D/N**: 時間帯（朝/昼/夕方/夜）
- **内容**: シーン内容の要約
- **登場人物マトリックス**: 各キャラクターの登場有無（○マーク）
- **小道具**: 使用される小道具
- **備考**: その他の情報

## 注意事項

- PDFからのテキスト抽出精度は元のPDF品質に依存します
- 手書きの台本や画像ベースのPDFは正しく解析できない場合があります
- 長い台本は自動的に15,000文字に切り詰められます
