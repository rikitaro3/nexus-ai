# Nexus

ドキュメントナビゲーションとタスク管理を統合した、マルチリポジトリ開発向けの Next.js アプリケーションです。

## Features

- **Docs Navigator**: カテゴリ別にドキュメントを探索し、詳細ビューからファイルを開けます
- **FEAT Cross-reference**: PRD / UX / API / DATA などのドキュメント横断で網羅性を確認できます
- **Orphan Detection**: 上流・下流リンクの不足を検出します
- **Tree View**: ドキュメント間の依存関係を DAG で可視化します
- **Tasks Management**: タスクのインポート・編集・保存・エクスポートに対応します
- **Breakdown Generation**: AI へ投げるタスク分解プロンプトを生成できます

## 使い方

1. 依存関係をインストールします。
   ```bash
   npm install
   ```
2. 開発サーバーを起動します。
   ```bash
   npm run dev
   ```
3. 本番ビルドを行う場合は次を実行します。
   ```bash
   npm run build
   npm start        # 本番ビルドを起動
   ```
4. Lint とテストは以下を利用します。
   ```bash
   npm run lint
   npm test
   ```
5. CI などで e2e テストを実施する場合は Playwright/Jest テンプレートを参照してください（Next.js 版のテスト基盤は docs/QA を参照）。

## ユースケース

- **大規模ドキュメントの横断的な可視化**: PRD、UX、API、データ仕様など複数文書を横断して関連性を確認し、抜け漏れを防ぎます。
- **タスク分解の効率化**: 既存ドキュメントを参照しながら、タスクの取り込み・編集・エクスポートを行って開発計画を整備できます。
- **品質ゲートの自動チェック**: CLI やワーカーから品質ゲートを実行して、リンク切れや不足を自動検出できます。
- **親プロジェクトへの組み込み**: Next.js アプリとして組織内ポータルやドキュメントハブに組み込めます。

## Development

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

Next.js のビルド成果物は `.next/` に配置されます。

### Run

```bash
npm run dev        # Next.js 開発サーバー
npm start          # 本番ビルド後に Next.js サーバーを起動
```

### Lint & Test

```bash
npm run lint
npm test
npm run test:watch
npm run test:coverage
```

### CLI ユーティリティ

品質ゲートやテンプレート生成などの CLI スクリプトは `scripts/` 以下にまとめています。Next.js 化後も Node.js ランタイムで実行できます。

#### ドキュメント品質ゲートの検証

```bash
node scripts/validate-docs-gates.js            # 人が読む想定のサマリーを出力（例）
node scripts/validate-docs-gates.js --json     # CI 連携向けの JSON を出力
```

主なオプション:

- `--context <path>` – `context.mdc` の代替パスを指定
- `--project-root <path>` – ドキュメントを探索するプロジェクトルートを上書き

#### 品質ゲートの自動修正

```bash
node scripts/apply-docs-gates.js --table     # 修正内容を表形式で確認
node scripts/apply-docs-gates.js --dry-run   # 変更を加えずに影響範囲を確認
```

主なオプション:

- `--project-root <path>` – 対象プロジェクトルートを指定
- `--context <path>` – 対象の `context.mdc` を明示的に指定
- `--dry-run` – 修正を保存せずにレポートのみ出力
- `--json` / `--table` – 出力形式を切り替え

#### テンプレートからのドキュメント生成

```bash
node scripts/generate-doc-from-template.js \
  --template prd-system-requirements \
  --output docs/PRD/システム要件定義書.mdc \
  --title "システム要件定義書" \
  --upstream docs/PRD/index.mdc \
  --downstream docs/ARCH/index.mdc
```

主なオプション:

- `--template <id or path>` – テンプレート ID もしくは YAML ファイルパス（必須）
- `--output <path>` – 生成先ファイル（必須、相対パスはプロジェクトルート基準）
- `--title`, `--layer`, `--tags`, `--upstream`, `--downstream` – フロントマターを上書き
- `--set key=value` – 任意のメタデータを追加
- `--force` – 既存ファイルを上書き

#### UI スクリーンショットのキャプチャ

Playwright を使って Next.js アプリをヘッドレスブラウザで操作し、主要画面のスクリーンショットを取得できます。

```bash
npm run capture:screenshots
```

実行すると `e2e-proof/screenshots/<timestamp>/` 以下に PNG を保存します。

### E2E Tests

Next.js アプリを起動した状態で Playwright や Jest のテストスイートを動かします。環境構築の詳細は `docs/QA/` を参照してください。

```bash
npm test
```

## File Structure

```
src/
├── app/                  # Next.js App Router エントリーポイント
│   ├── (routes)/         # ページとレイアウト
│   ├── api/              # Route Handlers (API Routes)
│   └── globals.css       # グローバルスタイル
├── components/           # UI/ドメインコンポーネント
│   ├── layout/           # レイアウト関連（Header/Footer など）
│   ├── docs/             # ドキュメントナビゲーション UI
│   └── tasks/            # タスク管理 UI
├── lib/                  # ドメインサービス・ユーティリティ
├── config/               # 設定値・フェッチャー
├── styles/               # 共有スタイル（CSS Modules など）
└── types/                # 共通型定義
public/                   # 公開アセット（context.mdc など）
docs/                     # プロジェクトドキュメント
scripts/                  # CLI スクリプト
```

## Current Status

✅ Next.js 開発サーバーでの基本的な画面遷移を確認済み
⚠️ Playwright を用いた Next.js 版 E2E テストは整備中
✅ Jest によるドメインロジックの単体テストは通過

## Repository Management

このリポジトリは親プロジェクトからの依存として取り込むことができます。Next.js アプリとしてサブモジュールに組み込む場合の手順は従来どおりです。

### Using as a Submodule

親プロジェクトへ追加:
```bash
git submodule add <nexus-ai-repo-url> tools/nexus
```

クローン後に初期化:
```bash
git submodule init
git submodule update
```

サブモジュール込みでクローン:
```bash
git clone --recurse-submodules <parent-repo-url>
```

参照先を更新:
```bash
cd tools/nexus
git pull origin main
cd ../..
git add tools/nexus
git commit -m "Update nexus submodule"
```

## Troubleshooting

- `npm run dev` でサーバーが立ち上がらない: 依存関係が最新か (`npm install`) を確認してください。
- ページが 404 になる: App Router のルーティング構成（`src/app/(routes)`）にページファイルが存在するか確認してください。
- API Routes が失敗する: `src/app/api/**/route.ts` でレスポンス形式と依存関係を確認してください。
