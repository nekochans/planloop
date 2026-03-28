# @nekochans/planloop

AI コーディングエージェントが作成した実装計画を他の AI エージェントでレビューを行い、品質改善のループを回す為のツールです。

## 必須環境

- Node.js >= 22

## セットアップ

```bash
npm install
```

## 開発コマンド

```bash
# ビルド
npm run build

# テスト
npm test

# Lint (Biome + Prettier)
npm run lint

# Format (Biome + Prettier)
npm run format
```

## Lint / Format の方針

- `.ts` ファイル → [ultracite](https://www.ultracite.ai/) (Biome) で lint & format
- `.yaml` `.yml` `.md` `.mdx` → [Prettier](https://prettier.io/) で format

## ディレクトリ構成

```
src/
  bin/
    planloop.ts   # CLI エントリポイント
dist/             # ビルド出力 (git 管理外)
```

## ライセンス

MIT
