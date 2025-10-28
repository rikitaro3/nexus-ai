# Nexus

Document navigator and tasks management tool for multi-repository development projects.

## Features

- **Docs Navigator**: Browse documents by category, view details, and open files
- **FEAT Cross-reference**: View feature coverage across PRD/UX/API/DATA/QA
- **Orphan Detection**: Find documents with missing upstream/downstream links
- **Tree View**: Visualize document relationships (DAG)
- **Tasks Management**: Import, edit, save, and export tasks
- **Breakdown Generation**: Generate prompts for AI task breakdown

## 使い方

1. `npm install` を実行して依存関係をインストールします。
2. ドキュメント品質ゲートを CLI で確認したい場合は `npm run validate:docs` または `npm run validate:docs -- --json` を利用します。
3. GUI でアプリを利用する場合は `npm run start:dev` でビルドと起動をまとめて行うか、`npm run build` の後に `npm start` で Electron アプリを起動します。
4. ドキュメントやタスクの編集結果を確認したい場合は、アプリ上でカテゴリやリンクを辿って目的のファイルを開き、必要に応じてエクスポート機能を使用します。
5. E2E テストで動作を検証する場合は `npm run test:e2e:playwright` を実行します。

## ユースケース

- **大規模ドキュメントの横断的な可視化**: PRD、UX、API、データ仕様など複数の文書を横断して関連性を確認し、抜け漏れを防ぎたい場合に有効です。
- **タスク分解の効率化**: 既存ドキュメントを参照しながら、タスクをインポート・編集・エクスポートして開発計画を整備するシーンで活用できます。
- **品質ゲートの自動チェック**: CI などで `npm run validate:docs` を用いれば、文書間のリンク切れや不足を自動で検出できます。
- **サブモジュールとしての組み込み**: 親プロジェクトに組み込んで、複数リポジトリを横断したドキュメント管理のハブとして運用できます。

## Development

### Setup

```bash
npm install
```

### Build (TypeScript)

```bash
npm run build
```

This compiles the Electron main and preload processes into `dist/`.

### Run

```bash
npm start              # Run (uses dist/main.js)
npm run start:dev      # Build + Run
```

### Quality Gates Validation (CLI)

Run the documentation quality gates without launching the GUI:

```bash
npm run validate:docs            # Human-readable summary
npm run validate:docs -- --json  # JSON output for automation
```

Options:

- `--context <path>` – specify an alternate `context.mdc` file.
- `--project-root <path>` – override the project root for resolving document paths.

### E2E Tests

```bash
npm run test:e2e:playwright
```

## File Structure

```
src/
├── main/           # Main Process (TypeScript)
│   └── main.ts
├── preload/        # Preload script (TypeScript)
│   └── preload.ts
└── renderer/       # Renderer Process UI (HTML/JS/CSS)
    ├── index.html
    ├── styles/
    │   └── app.css
    ├── features/
    │   ├── docs-navigator/
    │   │   └── docs-navigator.js
    │   └── tasks/
    │       └── tasks.js
    └── shared/
        └── app.js
docs/               # Documentation
test/               # Playwright, integration, and unit tests
legacy/             # Archived pre-TypeScript assets
context.mdc         # Nexus context map
```

## Current Status

✅ TypeScript build working
⚠️ E2E tests need debugging (Tree view not rendering)
✅ Manual testing confirmed working

## Repository Management

This repository can be used as a Git submodule in parent projects.

### Using as a Submodule

Add to parent project:
```bash
git submodule add <nexus-ai-repo-url> tools/nexus
```

Initialize after cloning parent:
```bash
git submodule init
git submodule update
```

Or clone with submodules:
```bash
git clone --recurse-submodules <parent-repo-url>
```

Update submodule reference:
```bash
cd tools/nexus
git pull origin main
cd ../..
git add tools/nexus
git commit -m "Update nexus submodule"
```

## Troubleshooting

If you see blank screen:
1. Make sure `dist/` exists: `npm run build`
2. Check that renderer files are in `src/renderer/`
3. Verify paths in `src/main/main.ts` are correct for TypeScript output

