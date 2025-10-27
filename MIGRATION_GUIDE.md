# Nexus Repository Migration Guide

このガイドでは、nexusアプリを独立したGitHubリポジトリ`nexus-ai`に移動する手順を説明します。

## 前提条件

1. GitHubに新しいリポジトリ`nexus-ai`を作成済みであること
2. リポジトリURL（例: `https://github.com/USERNAME/nexus-ai.git`）を準備
3. 現在のプロジェクトが`shikaku-app`のルートディレクトリにいること

## 移行手順

### 1. Nexusリポジトリの作成と初期コミット

```bash
# 新規ディレクトリを作成
mkdir -p /tmp/nexus-migration
cd /tmp/nexus-migration

# 元のプロジェクトからnexusをコピー
cp -r <shikaku-app>/tools/nexus ./nexus-ai

# コピーしたディレクトリに移動
cd nexus-ai

# Gitリポジトリを初期化
git init

# ファイルを追加（.gitignoreが正しく設定されていることを確認）
git add .

# 初回コミット
git commit -m "Initial commit: Nexus document navigator"

# リモートリポジトリを追加
git remote add origin https://github.com/USERNAME/nexus-ai.git

# メインブランチに設定
git branch -M main

# リモートにプッシュ
git push -u origin main
```

**重要**: `.gitignore`が正しく設定されていることを確認してください（node_modules、dist、coverage等が除外されていること）

### 2. 親プロジェクトでのサブモジュール追加

```bash
# shikaku-appのルートディレクトリに戻る
cd <shikaku-app>

# 既存のnexusディレクトリを削除（ファイルのみ、.gitは保護される）
# 注: 実際の削除は以下のステップで行う

# サブモジュールとして追加
git submodule add https://github.com/USERNAME/nexus-ai.git tools/nexus

# .gitmodulesファイルが生成されることを確認
cat .gitmodules

# コミット
git add .gitmodules tools/nexus
git commit -m "Add nexus-ai as submodule"
```

### 3. クローン後の初期化

他の開発者がプロジェクトをクローンする場合：

```bash
# 初回クローン時
git clone --recurse-submodules <shikaku-app-url>
cd shikaku-app

# 既にクローン済みの場合
cd shikaku-app
git submodule init
git submodule update
```

### 4. Nexusの更新・開発

#### Nexusリポジトリでの開発

```bash
cd tools/nexus

# 通常のGit操作が可能
git status
git add .
git commit -m "Update nexus features"
git push origin main
```

#### 親プロジェクトでの参照更新

```bash
# 親プロジェクトのルートで
cd tools/nexus
git pull origin main
cd ../..

# サブモジュールの参照を更新
git add tools/nexus
git commit -m "Update nexus submodule"
```

#### 親プロジェクトから直接更新（推奨しない）

```bash
cd tools/nexus

# 変更をコミット
git add .
git commit -m "Update nexus"
git push origin main

# 親プロジェクトに戻る
cd ../..
git add tools/nexus
git commit -m "Update nexus submodule"
```

## ファイル構成

### 作成済みファイル

- `tools/nexus/.gitignore` - 独立リポジトリ用の除外設定
- `tools/nexus/README.md` - サブモジュール使用方法の説明を追加済み

### 更新済みファイル

- `README.mdc` - サブモジュールのクローン・更新手順を追加
- `.cursor/context.mdc` - nexusがサブモジュールである旨を追記

## トラブルシューティング

### 問題: サブモジュールが空に見える

**解決策**:
```bash
git submodule update --init --recursive
```

### 問題: サブモジュールが古いコミットを参照している

**解決策**:
```bash
cd tools/nexus
git fetch origin
git checkout origin/main
cd ../..
git add tools/nexus
git commit -m "Update nexus to latest version"
```

### 問題: サブモジュールを削除したい

**解決策**:
```bash
# サブモジュールを削除
git submodule deinit tools/nexus
git rm tools/nexus
git commit -m "Remove nexus submodule"

# .gitmodulesと.git/modulesから完全削除
rm -rf .git/modules/tools/nexus
```

## 関連ドキュメント

- `tools/nexus/README.md` - Nexusの使用方法
- `README.mdc` - プロジェクト全体のセットアップガイド
- `.cursor/context.mdc` - AI開発者向けコンテキスト

## 完了後の確認

- [ ] `nexus-ai`リポジトリが正しく作成され、コードがプッシュされている
- [ ] `.gitmodules`ファイルが作成されている
- [ ] `git submodule status`でnexusが正しく表示される
- [ ] 他の開発者が`--recurse-submodules`でクローンできる
- [ ] nexus内でのgit操作が正常に動作する
- [ ] 親プロジェクトからのサブモジュール更新が可能

