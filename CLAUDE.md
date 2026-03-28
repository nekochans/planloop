# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

@nekochans/planloop is a Node.js CLI tool (installed via `npm install -g`) that reviews implementation plans created by AI coding agents using other AI agents to drive quality improvement loops. Written in TypeScript with ESM (`"type": "module"`).

## Commands

```bash
npm run build          # TypeScript build (tsc)
npm test               # Run all tests (vitest run)
npx vitest run src/path/to/file.test.ts  # Run a single test file
npm run lint           # Biome (ultracite) + Prettier check
npm run format         # Biome (ultracite) + Prettier auto-fix
```

## Architecture

- **Entry point**: `src/bin/planloop.ts` — CLI entry with shebang, mapped to `planloop` command via `bin` in package.json
- **Build output**: `dist/` (compiled from `src/` by tsc, git-ignored)
- **Module system**: ESM (Node16 module resolution)

## Lint / Format Strategy

- `.ts` files → ultracite (Biome) handles both linting and formatting
- `.yaml`, `.yml`, `.md`, `.mdx` → Prettier handles formatting
- Biome config extends `ultracite/biome/core` (see `biome.jsonc`)

## Dependency Management

- `.npmrc` enforces `save-exact=true` — all dependency versions must be pinned without `^` or `~` prefixes
- Use `npm install` (not yarn/pnpm)

## 関連ドキュメント

### **重要: 基本的なコーディングガイドライン**

必ず以下のドキュメントを参照してから開発を開始してください:

@docs/basic-coding-guidelines.md

## 品質管理

全ての開発タスク完了時に、以下の手順を順番に実施してください。1つでも異常終了した場合は、問題点を修正してエラーが出なくなるまで修正を繰り返してください。

1. `npm run format` — Formatterの適用
2. `npm run lint` — Linterエラーがないことを確認
3. `npm run test` — テストコードの実行
4. `npm run build` — ビルドが正常終了することを確認

## GitとGitHubワークフロールール

### GitHubの利用ルール

`gh` コマンドを利用してGitHubへのPRを作成する事が可能です。

許可されている操作は以下の通りです。

- GitHubへのPRの作成
- GitHubへのPRへのコメントの追加
- GitHub Issueの新規作成
- GitHub Issueへのコメントの追加

**以下の操作はユーザーの許可があれば可能です。**

- Gitへのコミット
- GitHubへのプッシュ

### コミットメッセージの作成ルール

- 対応issueがある場合は、コミットメッセージに `#<issue番号>` を記載します

### PR作成ルール

- ブランチはユーザーが作成しますので現在のブランチをそのまま利用します
- PRのタイトルは日本語で入力します
- PRの作成先は特別な指示がない場合は `main` ブランチになります
- PRの説明欄は @.github/PULL_REQUEST_TEMPLATE.md を参考に入力します
- 対応issueがある場合は、PRの説明欄に `#<issue番号>` を記載します
- Issue番号は現在のブランチ名から取得出来ます、例えば `feature/issue7/add-docs` の場合は `7` がIssue番号になります
- PRの説明欄には主に以下の情報を含めてください

#### PRの説明欄に含めるべき情報

- 変更内容の詳細説明よりも、なぜその変更が必要なのかを重視
- 他に影響を受ける機能やAPIエンドポイントがあれば明記

#### 以下の情報はPRの説明欄に記載する事を禁止する

- 1つのissueで1つのPRとは限らないので `fix #issue番号` や `close #issue番号` のようなコメントは禁止します
- 全てのテストをパス、Linter、型チェックを通過などのコメント（テストやCIが通過しているのは当たり前でわざわざ書くべき事ではない）
