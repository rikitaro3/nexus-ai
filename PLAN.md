# ドキュメント編集・閲覧機能のPRD作成プラン

## 概要

ドキュメントをアプリ内で閲覧・編集し、AI支援プロンプトを生成する機能の要件定義ドキュメントを作成します。

## 実施内容

### 1. PRD_DocumentEditor.mdcの作成

**ファイル:** `tools/nexus/docs/PRD/PRD_DocumentEditor.mdc`

**構成:**
- YAMLフロントマター（upstream/downstream設定）
- Breadcrumbs
- Purpose
- Features Registry（FEAT-0021〜0023）
- 機能仕様（各FEAT詳細）
- UI設計
- データフロー
- Phase別実装計画
- テスト要件

**FEAT番号:**
- **FEAT-0021**: ドキュメントビューア（モーダル/パネル表示）
- **FEAT-0022**: ドキュメント編集機能（保存）
- **FEAT-0023**: ドキュメント修正プロンプト生成・コピー

### 2. 関連ドキュメントの更新

**PRD/index.mdc:**
- downstreamに `PRD_DocumentEditor.mdc` を追加

**ARCH/共通コンポーネント設計.mdc:**
- upstreamに `PRD_DocumentEditor.mdc` を追加
- FEAT-0021〜0023の実装仕様セクションを追加

**public/context.mdc:**
- PRDカテゴリに `PRD_DocumentEditor.mdc` を追加

**要求仕様書.mdc:**
- Features Registryに FEAT-0021〜0023 を追加

### 3. Breadcrumbs構造

```
docs/PRD/index.mdc
  └─ docs/PRD/PRD_DocumentEditor.mdc (新規)
       └─ docs/ARCH/共通コンポーネント設計.mdc
            └─ docs/DEVELOPMENT/index.mdc
```

## 期待される成果

- ドキュメント編集機能の要件が明確化
- FEAT番号による管理
- 実装の優先順位とPhaseが明確
- トレーサビリティの確保

