# Issue #3: Claude Codeが作成した実装プランをCodexでレビューするループ機能の実装計画

## 1. 概要

### 1.1 目的

Claude Codeが作成した実装計画（Markdownファイル）を、Codex CLIでレビューし、レビュー指摘の修正→再レビューのループを半自動で回す機能を `planloop` CLIに実装する。

### 1.2 背景

[Zenn記事「AIコーディングの技術負債・理解負債排除手法」](https://zenn.dev/avaintelligence/articles/debt-free-ai-coding-practices) のステップ2.2〜2.5で手動実施しているレビュー往復（最大10往復以上）の自動化が目的。現状は都度Markdownファイルパスを変えてCodexにレビューを依頼し、結果をClaude Codeに渡す作業を手動で行っている。

### 1.3 設計方針

| 方針                       | 詳細                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 半自動オーケストレーション | 初回レビューは人間がtriageし、2回目以降は自動フィルタリング。完全自動化は過剰指摘の永久ループを招くため回避する    |
| 構造化出力                 | proseではなくJSON構造でレビュー結果を管理し、停止条件を機械的に判定する                                            |
| エージェント非依存         | アダプターパターンで将来的にClaude/Codex以外のAIエージェントに差し替え可能な設計                                   |
| CLI wrapper方式            | v1ではSDKではなくCLI（`claude -p`、`codex exec`）を`child_process`で呼び出す。認証やレート制限の問題を回避するため |
| 初回判断の永続化           | 人間のtriage判断をwaiver ruleとして保存し、次回以降のラウンドで自動フィルタとして再利用する                        |

### 1.4 全体フロー

```
planloop run --plan <plan-file> --prompt <prompt-file>
        │
        ▼
┌─── ループ開始 ───────────────────────────────────┐
│                                                   │
│  1. Codex exec でレビュー実行                     │
│     (構造化JSON出力, workspace-write sandbox)     │
│     ※毎回fresh run（セッション不要）              │
│        │                                          │
│        ▼                                          │
│  2. Waiver適用 & 前ラウンドとの差分比較           │
│        │                                          │
│        ▼                                          │
│  3. 人間トリアージ判定                            │
│     ├── 初回 → 必ずトリアージ                     │
│     └── 2回目以降 → 新規HIGH時のみトリアージ      │
│        │                                          │
│        ▼ (トリアージが必要な場合)                  │
│  3a. レビュー結果をトリアージファイルに書き出し    │
│  3b. $EDITOR でトリアージファイルを開く            │
│  3c. 人間が自然言語でフィードバックを記入          │
│      例: 「指摘2はスコープ外」                     │
│          「以後、互換性に関する指摘は対象外」      │
│  3d. fresh codex exec でフィードバック付き再レビュー│
│     (初回レビュー結果+人間フィードバックを含む)    │
│  3e. Codexが調整後のレビュー結果を返す             │
│  3f. フィードバックからwaiver ruleを抽出・永続化   │
│        │                                          │
│        ▼                                          │
│  4. Blocking findingsを抽出                       │
│     ├── 0件 → ループ終了                          │
│     └── 1件以上 → 次へ                            │
│        │                                          │
│  5. 停滞判定                                      │
│     ├── 同一fingerprint集合が連続 → 終了          │
│     └── 変化あり → 次へ                           │
│        │                                          │
│        ▼                                          │
│  6. Claude Code で実装計画を修正                   │
│     (curated reviewのみ渡す, fresh session)        │
│        │                                          │
│        ▼                                          │
│  7. ラウンド状態を記録                            │
│     └── 次のラウンドへ ─────────────────┘         │
│                                                   │
└───────────────────────────────────────────────────┘
        │
        ▼
   ループ終了（結果サマリー表示）
```

### 1.5 設計上の重要な判断

#### 1.5.1 `codex exec resume` を使用しない理由

初期設計ではトリアージ時に `codex exec resume --last` で前回セッションを再開する方針だったが、以下の理由で **fresh run 方式**に変更した:

1. **`resume` サブコマンドが `--output-schema` をサポートしていない**（codex-cli 0.117.0 で確認）。構造化出力をスキーマで制約できないため、planloop側で頑強にパースする追加負担が発生する。
2. **`--last` によるセッション特定が脆弱**。ユーザーが別ターミナルで `codex exec` を実行した場合、誤ったセッションを resume する危険がある。複数 run の並列実行にも耐えない。

代替として、トリアージ後の再レビューでは **初回レビュー結果 + 人間のフィードバックを含む新しいプロンプトで fresh `codex exec` を実行**する。これにより、セッション管理の複雑さを排除し、常に `--output-schema` による構造化出力を利用できる。

#### 1.5.2 レビュー工程で `workspace-write` を採用する理由

レビュー工程では `read-only` ではなく `workspace-write` サンドボックスを使用する。**v1ではこの設定は固定であり、設定ファイルで変更することはできない。** 実行コマンドは常に `--full-auto`（`workspace-write` + 自動承認のエイリアス）を使用する。理由は以下の通り:

- `gh` コマンド（GitHub Issue/PR の参照）の実行に `workspace-write` + `network_access = true` が必要
- MCP サーバー（Context7等）の利用に `workspace-write` が必要
- Web検索等のネットワークアクセスを伴うツール実行の安定性を確保するため

> 注: 将来的に `read-only` 等を選択可能にする場合は、`--full-auto` をやめて `--sandbox <value>` と approval 方針を明示的に組み立てる設計へ変更する必要がある（v2以降で検討）。

#### 1.5.3 `codex exec` でのWeb検索の有効化方法

`codex exec` サブコマンドには `--search` オプションが存在しない（codex-cli 0.117.0 で確認）。Web検索を non-interactive な `codex exec` で有効化するには、以下のいずれかの方法を使う:

1. **グローバル設定（推奨）**: `~/.codex/config.toml` のトップレベルに `web_search = "live"` を設定する。`codex exec` はグローバル設定を読み込むため、この設定があればWeb検索ツールが自動的に利用可能になる。
2. **コマンドラインオーバーライド**: `-c 'web_search="live"'` を `codex exec` に渡す。

**設定キーの一次情報による検証（codex-cli 0.117.0）:**

```
$ codex exec --enable web_search_request -c 'features.web_search_request=true' ...

→ `[features].web_search_request` is deprecated because web search is enabled by default.
  (Set `web_search` to "live", "cached", or "disabled" at the top level
  (or under a profile) in config.toml if you want to override it.)
```

上記のCLI出力により、以下が確認されている:

- **`[features].web_search_request` は deprecated**（旧形式。GitHub Issue #6031 / #7661 等で見られる記述は旧バージョン向け）
- **`web_search = "live" | "cached" | "disabled"` がトップレベルの正式な設定キー**（現行形式）
- Web検索は codex-cli 0.117.0 ではデフォルトで有効

planloop は v1 ではグローバル設定に `web_search = "live"` が設定されていることを前提条件とする（§2.1参照）。planloop 側でコマンドラインに `-c` を付加する追加実装は行わない。

> 注: `web_search` がグローバル設定で明示的に `"disabled"` に設定されている場合、Web検索は利用できない。エビデンス検証（§7.15）において `web_search` は `suggestedEvidence` に分類するため、未充足でも警告表示のみでレビューは続行する。`web_search` を `requiredEvidence` として扱いたい場合は、ユーザーがグローバル設定を正しく行った上で、エビデンス検証の結果を人間が確認する運用とする。

ただし、レビュー工程では **Codex がレビュー対象の plan ファイルを編集してはならない**。この制約は以下の「edit guard」により保証する:

- **レビュー前**: plan ファイルの内容をメモリ上にスナップショットとして保存し、SHA-256ハッシュも記録する
- **レビュー後**: plan ファイルのSHA-256ハッシュを再計算し、レビュー前と一致することを検証
- **不一致の場合**: スナップショットからplan ファイルを復元し、当該ラウンドを失敗扱いとしてエラーを報告する

> 注: ハッシュ値だけでは元の内容は復元できないため、ファイル内容そのものをスナップショットとして保持する。検知にはハッシュ比較（高速）を使い、復元にはスナップショット（正確）を使う二段構えとする。

## 2. 前提条件

### 2.1 実行環境

- Node.js >= 22（ESM対応）
- Claude Code CLIがインストール済み（`claude` コマンドが利用可能）
- Codex CLIがインストール済み（`codex` コマンドが利用可能）
- 各CLIの認証が完了済み
- Codexのグローバル設定（`~/.codex/config.toml`）で以下が設定済み:
  - `sandbox_mode = "workspace-write"` + `network_access = true`（ghコマンド等のネットワークアクセスに必要）
  - `web_search = "live"`（Web検索の有効化。§1.5.3参照）
  - レビュー時に使用するMCPサーバー（Context7等）の設定
  - 対象プロジェクトの `trust_level = "trusted"` 設定

### 2.2 プロジェクト設定

- TypeScript 6.x, ESM (`"type": "module"`, `"module": "Node16"`)
- Biome/ultracite によるlint/format
- vitestによるテスト
- `.npmrc` の `save-exact=true` によりバージョン固定

## 3. 追加する依存ライブラリ

### 3.1 dependencies

| ライブラリ | 用途                   | 選定理由                                         |
| ---------- | ---------------------- | ------------------------------------------------ |
| commander  | CLIフレームワーク      | サブコマンド対応、TypeScript型サポート、軽量     |
| zod        | スキーマバリデーション | 設定ファイル・構造化出力の型安全なバリデーション |
| yaml       | YAMLパーサー           | 設定ファイル（`.planloop/config.yml`）の読み込み |
| picocolors | ターミナル色付け       | 軽量（依存なし）、Finding表示の視認性向上        |

### 3.2 devDependencies

追加なし（既存の `@types/node`、`vitest` で十分）

### 3.3 インストールコマンド

```bash
npm install commander zod yaml picocolors
```

> 注: `.npmrc` の `save-exact=true` により、バージョンは自動的に固定される

### 3.4 対話型トリアージUIについて

v1では対話型トリアージを `process.stdin` / `process.stdout` を直接使用した最小限の実装で行う。`@inquirer/prompts` 等の追加ライブラリは、UX改善が必要になった時点で導入を検討する。

## 4. ディレクトリ構成

### 4.1 ソースファイル構成

```
src/
  bin/
    planloop.ts                  # CLIエントリポイント（既存を改修）
    planloop.test.ts             # CLIテスト（既存を改修）
  types/
    index.ts                     # 全型定義・定数
  config/
    schema.ts                    # Zodスキーマ定義
    loader.ts                    # 設定ファイル読み込み
    loader.test.ts
  adapters/
    types.ts                     # アダプターインターフェース定義
    claude-cli.ts                # Claude CLI アダプター
    claude-cli.test.ts
    codex-cli.ts                 # Codex CLI アダプター
    codex-cli.test.ts
  core/
    fingerprint.ts               # Finding fingerprint生成
    fingerprint.test.ts
    waiver.ts                    # Waiverマッチングロジック
    waiver.test.ts
    triage.ts                    # 対話型トリアージ
    triage.test.ts
    loop-runner.ts               # メインループオーケストレーター
    loop-runner.test.ts
  prompts/
    codex-review.ts              # Codexレビュープロンプト生成
    codex-review.test.ts
    claude-revision.ts           # Claude修正プロンプト生成
    claude-revision.test.ts
  display/
    result.ts                    # 結果サマリー表示
    result.test.ts
    stream-renderer.ts           # リアルタイム進捗表示
    stream-renderer.test.ts
  evidence/
    analyzer.ts                  # prompt/planからのエビデンス要件抽出
    analyzer.test.ts
    verifier.ts                  # toolsUsedとエビデンス要件の照合
    verifier.test.ts
  intervention/
    handler.ts                   # 途中介入ハンドラー
    handler.test.ts
```

### 4.2 設定・状態ファイル構成（ユーザープロジェクト側）

```
<project-root>/
  .planloop/
    config.yml                   # 設定ファイル（Git管理対象）
    runs/                        # 実行状態ディレクトリ（Git管理外）
      <run-id>/
        state.json               # ループ全体の状態
        round-1/
          codex-raw.jsonl        # Codex生出力
          review.json            # パース済みレビュー結果
          triage.json            # トリアージ決定
        round-2/
          ...
```

### 4.3 .gitignore への追加（ユーザープロジェクト側で必要）

```
.planloop/runs/
```

## 5. 型定義

### 5.1 src/types/index.ts

```typescript
// ---- Finding categories ----
export const FINDING_CATEGORIES = [
  "correctness",
  "spec_mismatch",
  "missing_acceptance_criteria",
  "migration_risk",
  "speculative_future",
  "unnecessary_fallback",
  "code_quality",
  "security",
  "performance",
  "other",
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

// ---- Finding severity ----
export const FINDING_SEVERITIES = ["high", "medium", "low"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

// ---- A single review finding ----
export type Finding = {
  id: string;
  summary: string;
  detail: string;
  severity: FindingSeverity;
  category: FindingCategory;
  fingerprint: string;
  lineRef?: string;
};

// ---- Triage result ----
export type TriageResult = {
  adjustedFindings: RawFinding[];
  humanFeedback: string;
  newWaivers: Waiver[];
};

// ---- Raw finding (fingerprint未設定、アダプターからの生出力) ----
export type RawFinding = Omit<Finding, "fingerprint">;

// ---- Persistent waiver rule ----
export type Waiver = {
  match: string;
  category?: FindingCategory;
  action: "ignore" | "downgrade";
  downgradeTo?: "non_blocking";
  reason: string;
};

// ---- Codex review result ----
export type ReviewResult = {
  round: number;
  timestamp: string;
  findings: Finding[];
  toolsUsed: string[];
  rawOutputPath: string;
};

// ---- Claude revision result ----
export type RevisionResult = {
  reflectedFindings: string[];
  summary: string;
  timestamp: string;
};

// ---- State for a single round ----
export type RoundState = {
  round: number;
  review: ReviewResult;
  humanFeedback?: string;
  actionableFindings: Finding[];
  revision?: RevisionResult;
};

// ---- Overall loop state ----
export type LoopStatus = "in_progress" | "completed" | "stopped";

export type LoopState = {
  runId: string;
  planFile: string;
  promptFile: string;
  rounds: RoundState[];
  waivers: Waiver[];
  status: LoopStatus;
  stopReason?: StopReason;
  startedAt: string;
  updatedAt: string;
};

// ---- Stop reason ----
export type StopReason =
  | "no_blocking_findings"
  | "stagnation"
  | "max_rounds"
  | "human_abort";

// ---- Evidence verification ----
export const EVIDENCE_SOURCES = [
  "gh", // GitHub CLI（Issue/PR参照）
  "figma_mcp", // Figma MCP
  "context7_mcp", // Context7 MCP（ライブラリドキュメント参照）
  "web_search", // Web検索
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export type EvidenceRequirement = {
  source: EvidenceSource;
  reason: string;
  matchPatterns: string[]; // toolsUsedとの照合に使うパターン（部分一致）
};

export type EvidenceVerificationResult = {
  required: Array<
    EvidenceRequirement & { satisfied: boolean; matchedTools: string[] }
  >;
  suggested: Array<
    EvidenceRequirement & { satisfied: boolean; matchedTools: string[] }
  >;
  allRequiredSatisfied: boolean;
};

// ---- Config ----
export type PlanloopConfig = {
  version: 1;
  paths: {
    reviewDir: string;
    runDir: string;
  };
  policy: {
    requireHumanOnFirstRound: boolean;
    requireHumanOnNewHighSeverity: boolean;
    maxRounds: number;
    stagnationRounds: number;
    blockingCategories: FindingCategory[];
    autoWaiveCategories: FindingCategory[];
  };
  review: {
    perspectives: string[];
    additionalInstructions?: string;
  };
  engines: {
    claude: {
      mode: "inherited" | "bare";
    };
  };
};
```

## 6. 設定ファイル仕様

### 6.1 設定ファイルの配置

- パス: `.planloop/config.yml` または `.planloop/config.yaml`
- プロジェクトルートからの相対パスで検索

### 6.2 完全な設定ファイル例

```yaml
version: 1

paths:
  reviewDir: design-docs-for-ai # curated reviewの出力先
  runDir: .planloop/runs # 実行状態の保存先

policy:
  requireHumanOnFirstRound: true # 初回ラウンドで必ず人間triageを挟む
  requireHumanOnNewHighSeverity: true # 新規HIGH指摘時に人間ゲートを開く
  maxRounds: 8 # 最大ラウンド数
  stagnationRounds: 2 # 停滞判定の閾値（同一fingerprintが連続するラウンド数）
  blockingCategories: # blockingとして扱うカテゴリ
    - correctness
    - spec_mismatch
    - missing_acceptance_criteria
    - migration_risk
  autoWaiveCategories: # 自動でwaiveするカテゴリ
    - speculative_future
    - unnecessary_fallback

review:
  perspectives: # レビュー時の観点（カスタマイズ可能）
    - "correctness: 実装計画の内容が要件と一致しているか"
    - "spec_mismatch: 仕様との不一致がないか"
    - "missing_acceptance_criteria: 受け入れ基準の漏れがないか"
    - "migration_risk: マイグレーションリスクがないか"
    - "security: セキュリティ上の懸念がないか"
    - "performance: パフォーマンス上の懸念がないか"
  additionalInstructions: | # レビュアーへの追加指示（任意）
    必ず関連情報を確認してからレビューを行ってください。
    - GitHubのIssueやPRがあればghコマンドで内容を確認
    - 特定のライブラリの利用方法はドキュメントで確認
    - 不明点はWeb検索で確認

engines:
  # codex: v1ではサンドボックスモードは workspace-write 固定（§1.5.2参照）
  # --full-auto（workspace-write + 自動承認）を常に使用する
  # 将来的にread-only等を選択可能にする場合はv2で対応
  claude:
    mode: inherited # Claude Codeの実行モード
```

### 6.3 デフォルト値

設定ファイルが存在しない場合、上記の値がデフォルトとして使用される。部分的な設定も可能で、未指定のフィールドにはデフォルト値が適用される。

### 6.4 Zodスキーマ (src/config/schema.ts)

```typescript
import { z } from "zod";
import { FINDING_CATEGORIES } from "../types/index.js";

const findingCategorySchema = z.enum(FINDING_CATEGORIES);

export const configSchema = z.object({
  version: z.literal(1),
  paths: z
    .object({
      reviewDir: z.string().default("design-docs-for-ai"),
      runDir: z.string().default(".planloop/runs"),
    })
    .default({}),
  policy: z
    .object({
      requireHumanOnFirstRound: z.boolean().default(true),
      requireHumanOnNewHighSeverity: z.boolean().default(true),
      maxRounds: z.number().int().min(1).max(20).default(8),
      stagnationRounds: z.number().int().min(1).max(10).default(2),
      blockingCategories: z
        .array(findingCategorySchema)
        .default([
          "correctness",
          "spec_mismatch",
          "missing_acceptance_criteria",
          "migration_risk",
        ]),
      autoWaiveCategories: z
        .array(findingCategorySchema)
        .default(["speculative_future", "unnecessary_fallback"]),
    })
    .default({}),
  review: z
    .object({
      perspectives: z
        .array(z.string())
        .default([
          "correctness: 実装計画の内容が要件と一致しているか",
          "spec_mismatch: 仕様との不一致がないか",
          "missing_acceptance_criteria: 受け入れ基準の漏れがないか",
          "migration_risk: マイグレーションリスクがないか",
          "security: セキュリティ上の懸念がないか",
          "performance: パフォーマンス上の懸念がないか",
        ]),
      additionalInstructions: z.string().optional(),
    })
    .default({}),
  engines: z
    .object({
      // codex: v1ではサンドボックスモードは workspace-write 固定のため設定項目なし
      claude: z
        .object({
          mode: z.enum(["inherited", "bare"]).default("inherited"),
        })
        .default({}),
    })
    .default({}),
});

export type ConfigInput = z.input<typeof configSchema>;
```

## 7. 各モジュールの詳細仕様

### 7.1 設定ファイル読み込み (src/config/loader.ts)

#### 責務

- `.planloop/config.yml` の検索と読み込み
- Zodスキーマによるバリデーションとデフォルト値適用
- 設定ファイルが存在しない場合はデフォルト設定を返す

#### 公開関数

```typescript
/**
 * プロジェクトルートから設定ファイルを読み込む
 * @param basePath プロジェクトルートの絶対パス
 * @returns バリデーション済みの設定オブジェクト
 * @throws 設定ファイルの内容が不正な場合
 */
export const loadConfig = async (basePath: string): Promise<PlanloopConfig>;
```

#### 処理フロー

1. `basePath/.planloop/config.yml` を試みる
2. 存在しなければ `basePath/.planloop/config.yaml` を試みる
3. どちらも存在しなければデフォルト設定を返す
4. ファイルが存在する場合はYAMLパース → Zodバリデーション
5. バリデーションエラー時は具体的なエラーメッセージを含む例外をスロー

#### テスト項目 (src/config/loader.test.ts)

- 正常な設定ファイルの読み込みとパース
- `.yml` / `.yaml` 両拡張子の対応
- 設定ファイル不存在時のデフォルト値適用
- 部分的な設定での未指定フィールドへのデフォルト適用
- 不正なYAML構文でのエラー
- スキーマバリデーションエラー（不正なversion、範囲外のmaxRounds等）
- review.perspectivesのカスタム設定の読み込み
- review.additionalInstructionsの読み込み（設定あり/なし）
- review未設定時のデフォルトレビュー観点の適用

### 7.2 アダプターインターフェース (src/adapters/types.ts)

#### 責務

- レビュー実行とプラン修正のインターフェースを定義
- エージェント非依存の抽象化レイヤー

```typescript
import type {
  Finding,
  RawFinding,
  RevisionResult,
  Waiver,
} from "../types/index.js";

/** レビューアダプターへの入力コンテキスト */
export type ReviewContext = {
  round: number;
  previousWaivers: Waiver[];
  previousFindings: Finding[];
};

/** レビューアダプターの出力（RawFindingはtypes/index.tsで定義） */
export type ReviewAdapterResult = {
  findings: RawFinding[];
  toolsUsed: string[];
  rawOutput: string;
};

/** トリアージ付き再レビューの入力コンテキスト */
export type FeedbackReviewContext = {
  round: number;
  originalFindings: RawFinding[];
  humanFeedback: string;
};

/** レビュー実行アダプター（Codex等） */
export type ReviewAdapter = {
  /** 実装計画の初回レビューを実行する */
  review: (
    planContent: string,
    promptContent: string,
    context: ReviewContext,
  ) => Promise<ReviewAdapterResult>;

  /**
   * 人間のフィードバックを踏まえた再レビューを実行する（fresh run）
   * 初回レビュー結果と人間のフィードバックを含む新しいプロンプトで
   * fresh codex exec を実行し、調整後のfindingsを取得する
   */
  reviewWithFeedback: (
    planContent: string,
    promptContent: string,
    context: FeedbackReviewContext,
  ) => Promise<ReviewAdapterResult>;
};

/** プラン修正アダプター（Claude等） */
export type RevisionAdapter = {
  revise: (
    planFile: string,
    promptFile: string,
    findings: Finding[],
  ) => Promise<RevisionResult>;
};
```

### 7.3 Codex CLI アダプター (src/adapters/codex-cli.ts)

#### 責務

- Codex CLIを子プロセスとして実行し、実装計画のレビューを取得する
- 構造化JSON出力をパースしてFinding配列を返す

#### 公開関数

```typescript
export const createCodexCliAdapter = (config: PlanloopConfig): ReviewAdapter;
```

#### Codex CLI実行コマンド（共通: review / reviewWithFeedback 両方）

```bash
echo "<レビュープロンプト>" | codex exec \
  --json \
  --full-auto \
  --ephemeral \
  --output-schema /tmp/planloop-xxxx/review-schema.json \
  -o /tmp/planloop-xxxx/last-message.txt \
  -
```

> 注:
>
> - プロンプトが長文になるため、引数ではなくstdin経由（末尾の `-`）で渡す
> - `--output-schema` はファイルパスを受け取るため、JSON Schemaファイルを一時ディレクトリに書き出す必要がある
> - **`--full-auto`** を使用する。これは `--sandbox workspace-write` + 自動承認のエイリアスで、非対話モードでもghコマンド・MCPが自動実行される。v1ではサンドボックスモードは `workspace-write` 固定のため、常にこのフラグを使用する（§1.5.2参照）
> - **`--ephemeral` を使用する**。毎回 fresh run のためセッション保持は不要（§1.5.1参照）
> - **Web検索**: `codex exec` には `--search` オプションがないため、グローバル設定 `~/.codex/config.toml` の `web_search = "live"` に依存する（§1.5.3参照）。planloop側でのコマンドライン追加は行わない
> - **MCP サーバー**（Context7等）はユーザーのグローバル設定 `~/.codex/config.toml` から自動的に読み込まれる。planloop側での追加設定は不要
> - `review` と `reviewWithFeedback` はどちらもこのコマンド形式を使用する。違いはプロンプト内容のみ

#### 処理フロー（初回レビュー: `review` メソッド）

1. planファイルの内容をメモリ上にスナップショットとして保存し、SHA-256ハッシュを記録する（edit guard: §1.5.2参照）
2. `generateCodexReviewPrompt()` でレビュープロンプトを生成
3. JSON Schemaファイルを一時ディレクトリに書き出す（`--output-schema` 用）
4. プロンプトをstdin経由で `codex exec` に渡し、`child_process.spawn` で実行
   - `--json`: JSONL形式でイベントストリームを出力
   - `--full-auto`: `workspace-write` サンドボックス + 自動承認（ghコマンド・MCP・Web検索を非対話で自動実行）
   - `--ephemeral`: セッションを保持しない（fresh run方式）
   - `--output-schema <file>`: レビュー結果のJSON Schema制約
   - `-o <file>`: 最終メッセージをファイルに書き出し
5. **`--json` のJSONLストリームを `renderStream()` でリアルタイム表示**しつつ、全出力を収集する
6. `-o` で書き出されたファイルからFinding配列をパースする（最も信頼性が高い）
7. JSONLイベントから `toolsUsed` を収集: `command_execution` → コマンド文字列、`mcp_tool_call` → `ツール名: 入力概要`、`web_search` → `web_search: 検索クエリ`
8. **edit guard検証**: planファイルのSHA-256ハッシュを再計算し、手順1と一致することを確認。不一致の場合は手順1で保存したスナップショットからファイルを復元し、エラーを報告する
9. **エビデンス検証**: `toolsUsed` と事前に組み立てた `requiredEvidence` / `suggestedEvidence` を照合する（§7.15参照）

#### 処理フロー（フィードバック付き再レビュー: `reviewWithFeedback` メソッド）

1. planファイルの内容をメモリ上にスナップショットとして保存し、SHA-256ハッシュを記録する（edit guard）
2. `generateCodexFeedbackReviewPrompt()` でフィードバック付き再レビュープロンプトを生成
   - 初回レビューの findings 一覧を含める
   - 人間のフィードバック内容を含める
   - 「フィードバックを踏まえ、未解決のblocking issueのみを再出力」する指示を含める
3. JSON Schemaファイルを一時ディレクトリに書き出す（初回と同じスキーマ）
4. プロンプトをstdin経由で fresh `codex exec` に渡し、`child_process.spawn` で実行（初回と同じオプション）
5. 出力の収集・パース（初回と同じ手順）
6. edit guard検証（初回と同じ）

#### Codexへの出力スキーマ（レビュー結果のJSON構造）

`--output-schema` に渡すJSON Schemaファイルの内容:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["findings"],
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "summary", "detail", "severity", "category"],
        "properties": {
          "id": { "type": "string" },
          "summary": { "type": "string" },
          "detail": { "type": "string" },
          "severity": { "type": "string", "enum": ["high", "medium", "low"] },
          "category": {
            "type": "string",
            "enum": [
              "correctness",
              "spec_mismatch",
              "missing_acceptance_criteria",
              "migration_risk",
              "speculative_future",
              "unnecessary_fallback",
              "code_quality",
              "security",
              "performance",
              "other"
            ]
          },
          "lineRef": { "type": "string" }
        }
      }
    }
  }
}
```

期待される出力例:

```json
{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明",
      "severity": "high",
      "category": "correctness",
      "lineRef": "## 7.3 の手順4"
    }
  ]
}
```

#### Codex JSONL出力のイベント構造

`--json` オプション使用時、Codexはstdoutに1行1JSONオブジェクトのJSONL形式でイベントを出力する。主要なイベントタイプ:

```jsonl
{"type": "message", "role": "assistant", "content": "..."}
{"type": "command_execution", "command": "gh issue view 3", "exit_code": 0}
{"type": "mcp_tool_call", "tool": "context7_query", "input": {...}}
{"type": "plan_update", "plan": "..."}
```

planloopが活用するイベント:

- `command_execution`: `toolsUsed` に実行コマンド文字列そのもの（例: `"gh issue view 3"`, `"npm ls"`）を記録する。エビデンス検証（§7.15）で `gh issue` / `gh pr` 等のパターンと部分一致で照合するため、粗い種別（`"command"` 等）ではなく具体的なコマンド文字列が必要
- `mcp_tool_call`: `toolsUsed` に `"<tool名>: <input概要>"` の形式で記録する（例: `"context7_query: commander.js"`, `"figma_get_frame: https://figma.com/..."`)。ツール名だけでなく入力概要も残すことで、どの情報源にアクセスしたかを後段で判定可能にする
- `web_search`: `toolsUsed` に `"web_search: <検索クエリ>"` の形式で記録する
- 最終 `message` イベント: Finding JSONの抽出元（`-o` ファイルが利用できない場合のフォールバック）

#### Codex出力のバリデーションスキーマ（planloop側）

`-o` で取得した最終メッセージまたはJSONLから抽出したFinding JSONを、Zodスキーマでバリデーションする:

```typescript
import { z } from "zod";
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from "../types/index.js";

export const codexFindingSchema = z.object({
  id: z.string(),
  summary: z.string(),
  detail: z.string(),
  severity: z.enum(FINDING_SEVERITIES),
  category: z.enum(FINDING_CATEGORIES),
  lineRef: z.string().optional(),
});

export const codexReviewOutputSchema = z.object({
  findings: z.array(codexFindingSchema),
});
```

> 注: CodexがJSON Schema制約に完全に従わない場合も想定し、Zodバリデーション失敗時はエラー詳細をログ出力し、パース可能な部分だけを救済する（partial parsing）。

#### エラーハンドリング

- `codex` コマンドが見つからない場合: `ENOENT` → 「Codex CLIがインストールされていません」メッセージ
- タイムアウト（5分）: プロセスをkillし、タイムアウトエラーを返す
- 非ゼロ終了コード: stderrの内容を含むエラーを返す
- JSON パース失敗: 生出力を保存し、パースエラーを返す

#### テスト項目 (src/adapters/codex-cli.test.ts)

- 正常なレビュー結果のパース
- JSONL出力からのFinding抽出
- toolsUsedの収集（command_execution, mcp_tool_call, web_search）
- `codex` 未インストール時のエラーメッセージ
- タイムアウト時の挙動
- 不正なJSON出力時のフォールバック
- `reviewWithFeedback` メソッドでのfresh run実行（初回findings + フィードバックを含むプロンプト）
- `reviewWithFeedback` メソッドでの調整後Finding配列のパース
- edit guard: planファイルが変更されていた場合のエラー検出とスナップショットからの復元
- edit guard: planファイルが変更されていない場合の正常通過
- edit guard: スナップショットからの復元後、ファイル内容がレビュー前と一致すること

> 注: テストでは `child_process.spawn` をモックし、実際のCodex CLIは呼び出さない

### 7.4 Claude CLI アダプター (src/adapters/claude-cli.ts)

#### 責務

- Claude Code CLIを子プロセスとして実行し、実装計画の修正を行う
- curated reviewのみをClaudeに渡し、修正結果を取得する

#### 公開関数

```typescript
export const createClaudeCliAdapter = (config: PlanloopConfig): RevisionAdapter;
```

#### Claude CLI実行コマンド

```bash
echo "<修正プロンプト>" | claude -p \
  --output-format stream-json \
  --json-schema '{"type":"object","properties":{"reflectedFindings":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"}},"required":["reflectedFindings","summary"]}' \
  --no-session-persistence \
  --allowedTools "Edit,Read,Glob,Grep" \
  --permission-mode acceptEdits
```

> 注: `--json-schema` によりClaude CLIレベルで出力を構造化JSON形式に制約できる。`--no-session-persistence` を指定し、プログラマティック実行でセッション履歴が肥大化するのを防ぐ。`--allowedTools` で実装計画ファイルの編集に必要な最小限のツールに制限する。`--permission-mode acceptEdits` を指定し、ファイル編集時に対話的な許可プロンプトが出ることを防ぐ。

#### 処理フロー

1. `generateClaudeRevisionPrompt()` で修正プロンプトを生成
2. プロンプトをstdin経由で `claude -p` に渡し、`child_process.spawn` で実行
   - `-p`: 非対話（print）モード
   - `--output-format stream-json`: ストリーミングJSON形式で出力（リアルタイム表示用）
   - `--json-schema <schema>`: 構造化出力のJSON Schema制約（インラインJSON）
   - `--no-session-persistence`: セッションをディスクに保存しない
   - `--allowedTools "Edit,Read,Glob,Grep"`: 最小限のツール権限
3. **stream-JSON出力を `renderStream()` でリアルタイム表示**しつつ、全出力を収集する
4. 収集した全出力から最終結果の `reflectedFindings` と `summary` を抽出
5. `RevisionResult` を返す

#### Claudeへの修正プロンプトに含める情報

- 実装計画ファイルのパス
- curated review（triage済みのblocking findingsのみ）
- 修正指示
- 出力形式の指定（反映したfindingのIDリスト + 変更概要）

#### エラーハンドリング

- `claude` コマンドが見つからない場合: `ENOENT` → 「Claude Code CLIがインストールされていません」メッセージ
- タイムアウト（10分）: プロセスをkillし、タイムアウトエラーを返す
- 非ゼロ終了コード: stderrの内容を含むエラーを返す
- `--json-schema` バリデーション失敗: Claude CLIが自動でリトライするため、通常は追加処理不要

#### テスト項目 (src/adapters/claude-cli.test.ts)

- 正常な修正結果のパース
- `-p` モードでの実行引数の正確性
- `claude` 未インストール時のエラーメッセージ
- タイムアウト時の挙動

> 注: テストでは `child_process.spawn` をモックし、実際のClaude CLIは呼び出さない

### 7.5 フィンガープリント生成 (src/core/fingerprint.ts)

#### 責務

- 各Findingに対して安定したフィンガープリントを生成する
- 異なるラウンドで同一概念の指摘が言い換えられても、同じfingerprintを返す

#### 公開関数

```typescript
/**
 * Findingのフィンガープリントを生成する
 * @param finding フィンガープリント対象のFinding（fingerprint未設定）
 * @returns SHA-256ベースのフィンガープリント文字列
 */
export const generateFingerprint = (finding: Omit<Finding, "fingerprint">): string;
```

#### アルゴリズム

1. `category` を取得（最も安定した識別子）
2. `summary` を正規化:
   - 小文字化
   - 数値を `<NUM>` に置換（行番号等のブレを吸収）
   - 連続する空白を単一スペースに
   - 先頭末尾の空白を除去
3. `category + ":" + normalizedSummary` を結合
4. SHA-256ハッシュの先頭16文字をフィンガープリントとして返す

#### テスト項目 (src/core/fingerprint.test.ts)

- 同一内容のFindingに対して同一のfingerprintを返す
- summaryの微妙な言い換え（数値の変更、大文字小文字）で同一fingerprintを返す
- 異なるcategory/summaryのFindingに対して異なるfingerprintを返す
- 空文字列のsummaryでもエラーにならない

### 7.6 Waiverマッチング (src/core/waiver.ts)

#### 責務

- Waiver ruleのリストに基づいてFindingをフィルタリングする
- カテゴリベースのwaive（`autoWaiveCategories`）も処理する

#### 公開関数

```typescript
/**
 * WaiverルールをFindingリストに適用する
 * @param findings フィルタリング対象のFinding配列
 * @param waivers 適用するWaiverルール配列
 * @param autoWaiveCategories 自動waiveするカテゴリ配列
 * @returns フィルタリング結果（waived / active / downgraded）
 */
export const applyWaivers = (
  findings: Finding[],
  waivers: Waiver[],
  autoWaiveCategories: FindingCategory[],
): WaiverResult;

export type WaiverResult = {
  active: Finding[];
  waived: Array<{ finding: Finding; reason: string }>;
  downgraded: Array<{ finding: Finding; from: "blocking"; to: "non_blocking" }>;
};
```

#### マッチングロジック

1. `autoWaiveCategories` に含まれるカテゴリのFindingを自動waive
2. 各Waiverの `match` 文字列をFindingの `summary` + `detail` に対して部分一致検索
3. Waiverに `category` が指定されている場合は、カテゴリも一致する必要がある
4. `action: "ignore"` → waivedリストに追加
5. `action: "downgrade"` → downgradedリストに追加
6. どのWaiverにもマッチしなかったFinding → activeリストに追加

#### テスト項目 (src/core/waiver.test.ts)

- autoWaveCategoriesによる自動waive
- match文字列による部分一致
- categoryフィルタ付きWaiverのマッチング
- ignore / downgradeの正しい分類
- 複数Waiverのどれにもマッチしないケース
- 空のWaiverリストでの全Finding active

### 7.7 自然言語トリアージ (src/core/triage.ts)

#### 責務

- Codexのレビュー結果をトリアージファイルとして書き出す
- `$EDITOR` でトリアージファイルを開き、人間が自然言語でフィードバックを記入できるようにする
- 人間のフィードバックを `reviewWithFeedback`（fresh codex exec）でCodexに送信し、調整後のレビュー結果を取得する
- フィードバック内容からwaiver ruleを抽出して永続化する

#### 設計思想

Issue #3のChatGPT会話に明記されている通り、人間のUXは自然言語のままとし、内部では構造化して保存する:

> 入力は自然言語のまま受ける。でも内部では構造化して保存する。

人間は自然言語でこう書く:

```
- 指摘 2 は対象外。今回は既存互換性を担保する変更ではない
- 指摘 4 は方向性だけ採用。フォールバック実装の追加までは不要
- 指摘 5 は blocking ではなく non-blocking
- 以後、「将来必要になるかもしれない拡張性」だけの指摘は無視
```

ツール側ではこれを waiver rule として保存し、次回以降のラウンドで自動フィルタとして再利用する。

#### 公開関数

```typescript
/**
 * エディタベースの自然言語トリアージを実行する
 * @param findings トリアージ対象のFinding配列
 * @param round ラウンド番号
 * @param planContent 実装計画の内容（フィードバック付き再レビューに渡す）
 * @param promptContent プロンプトの内容（フィードバック付き再レビューに渡す）
 * @param reviewAdapter フィードバック付き再レビュー実行用のアダプター
 * @param config 設定
 * @returns トリアージ結果（調整後のfindings + 新規waiver rules）
 */
export const runNaturalLanguageTriage = async (
  findings: RawFinding[],
  round: number,
  planContent: string,
  promptContent: string,
  reviewAdapter: ReviewAdapter,
  config: PlanloopConfig,
): Promise<TriageResult>; // TriageResult は src/types/index.ts で定義済み
```

#### トリアージファイル仕様

トリアージファイルは一時ディレクトリに以下の形式で生成される:

```markdown
# Codex レビュー結果 (Round 1)

以下はCodexによるレビュー指摘です。内容を確認し、下部のコメントセクションにフィードバックを記入してください。

## finding-1 [HIGH] correctness

API endpoint path does not match the specification.
The plan references /api/v2/users but the spec defines /api/v1/users.

## finding-2 [MEDIUM] spec_mismatch

The error handling strategy doesn't cover network timeout scenarios.

## finding-3 [LOW] speculative_future

Consider adding pagination support for future scaling needs.

---

# トリアージコメント

以下に自然言語でレビュー内容への指摘・調整を記入してください。
保存してエディタを閉じると、フィードバックがCodexに送信されます。

例:

- 指摘2はこの仕様上レビュー対象外
- 指摘3は将来の話なので無視
- 以後、互換性に関する指摘は対象外にしてください
```

#### 処理フロー

1. **トリアージファイル生成**: findings をMarkdown形式で一時ファイルに書き出す
2. **エディタ起動**: `$EDITOR`（未設定時は `vi`）でトリアージファイルを開く
3. **フィードバック抽出**: エディタ終了後、`---` セパレータ以降のテキストを人間のフィードバックとして抽出
4. **フィードバックが空の場合**: フィードバックなし（全指摘をそのまま受け入れ）としてトリアージを終了
5. **フィードバック付き再レビュー実行**: `reviewAdapter.reviewWithFeedback()` を呼び出す。これは fresh `codex exec` を実行し、以下のコンテキストを含むプロンプトをCodexに渡す:
   - 初回レビューの findings 一覧
   - 人間のフィードバック内容
   - 「フィードバックを踏まえ、未解決のblocking issueのみを再出力」する指示
6. **調整後レビューのパース**: Codexの応答から調整後のfinding配列を抽出（`--output-schema` による構造化出力のため、パースは初回レビューと同じ方式）
7. **Waiver rule抽出**: フィードバックテキストを解析し、永続的なwaiver ruleを生成
   - 「以後〜」「今後〜」「今回以降〜」を含む文はwaiver ruleとして保存
   - 具体的な指摘IDへの言及（「指摘Nは対象外」等）は `ignore-once` として扱い、waiver化しない

#### Waiver rule抽出ロジック

```typescript
/**
 * 人間のフィードバックテキストからwaiver ruleを抽出する
 * 「以後」「今後」「今回以降」等のキーワードを含む行を永続的なwaiver ruleとして扱う
 */
export const extractWaiversFromFeedback = (feedback: string): Waiver[];
```

抽出ルール:

- `以後`、`今後`、`今回以降`、`以降` を含む行 → waiver rule として保存
  - 例: `以後、「将来必要になるかもしれない拡張性」だけの指摘は無視` → `{ match: "将来必要になるかもしれない拡張性", action: "ignore", reason: "..." }`
- それ以外の行 → 今回のラウンドのみに適用（waiver化しない）

> 注: v1ではキーワードベースの単純な抽出とする。将来的にはLLMによる意味解析での抽出も検討可能。

#### テスト項目 (src/core/triage.test.ts)

- トリアージファイルの正しいMarkdown生成（findings全件が含まれること）
- フィードバック抽出（`---` セパレータ以降のテキスト取得）
- フィードバックが空の場合の処理（全指摘をそのまま受け入れ）
- waiver ruleの抽出（「以後」「今後」キーワード検出）
- waiver ruleでない行（今回限りの指摘）の正しい分類
- `reviewWithFeedback` 呼び出し時のコンテキスト（findings + feedback）の正しい構成
- `$EDITOR` 環境変数未設定時のフォールバック（`vi`）

> 注: テストではエディタ起動をモック（トリアージファイルへの書き込みをシミュレート）し、ReviewAdapterの `reviewWithFeedback` 呼び出しもモックする

### 7.8 ループランナー (src/core/loop-runner.ts)

#### 責務

- レビュー→triage→修正のループ全体をオーケストレーションする
- ループ状態の永続化と復元を管理する

#### 公開関数

```typescript
/**
 * レビューループを実行する
 * @param options ループ実行のオプション
 * @returns ループ完了後の最終状態
 */
export const runLoop = async (options: RunLoopOptions): Promise<LoopState>;

export type RunLoopOptions = {
  planFile: string;
  promptFile: string;
  config: PlanloopConfig;
  reviewAdapter: ReviewAdapter;
  revisionAdapter: RevisionAdapter;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
};
```

#### ループロジック（疑似コード）

```typescript
const runLoop = async (options: RunLoopOptions): Promise<LoopState> => {
  const { planFile, promptFile, config, reviewAdapter, revisionAdapter } =
    options;
  const runId = generateRunId(); // 例: "2026-03-28T21-40-00"
  let state = initializeState(runId, planFile, promptFile);

  // 入力ファイルの存在チェック
  await validateInputFiles(planFile, promptFile);

  for (let round = 1; round <= config.policy.maxRounds; round++) {
    // 1. 実装計画の内容を読み込む（毎ラウンド読み直す: Claude修正後の内容を取得するため）
    const planContent = await readFile(planFile, "utf-8");
    const promptContent = await readFile(promptFile, "utf-8");

    // 2. Codexでレビュー実行
    const reviewResult = await reviewAdapter.review(
      planContent,
      promptContent,
      {
        round,
        previousWaivers: state.waivers,
        previousFindings: getPreviousFindings(state),
      },
    );

    // 3. 各FindingにFingerprintを付与
    const findings = reviewResult.findings.map((f) => ({
      ...f,
      fingerprint: generateFingerprint(f),
    }));

    // 4. Waiver適用
    const waiverResult = applyWaivers(
      findings,
      state.waivers,
      config.policy.autoWaiveCategories,
    );

    // 5. 人間トリアージ判定
    let activeFindingsForRevision = waiverResult.active;
    let triageResult: TriageResult | undefined;
    if (needsHumanGate(round, waiverResult.active, state, config)) {
      // 自然言語トリアージ:
      // エディタを開き、人間がフィードバックを記入
      // → fresh codex exec（reviewWithFeedback）でCodexに送信
      // → 調整後のfindingsを取得
      triageResult = await runNaturalLanguageTriage(
        waiverResult.active,
        round,
        planContent,
        promptContent,
        reviewAdapter,
        config,
      );
      activeFindingsForRevision = triageResult.adjustedFindings;
      state.waivers.push(...triageResult.newWaivers);
    }

    // 6. Blocking findingsを抽出（blockingCategoriesに基づいて自動判定）
    const actionable = filterByBlockingCategories(
      activeFindingsForRevision,
      config,
    );

    // 7. 停止条件チェック
    if (actionable.length === 0) {
      state.status = "completed";
      state.stopReason = "no_blocking_findings";
      break;
    }
    if (isStagnating(state, actionable, config.policy.stagnationRounds)) {
      state.status = "stopped";
      state.stopReason = "stagnation";
      break;
    }

    // 8. Claude Codeで修正
    const revision = await revisionAdapter.revise(
      planFile,
      promptFile,
      actionable,
    );

    // 9. 生出力をファイルに保存し、rawOutputPath を取得
    const rawOutputPath = await saveRawOutput(
      config.paths.runDir,
      state.runId,
      round,
      reviewResult.rawOutput,
    );

    // 10. ラウンド状態を記録
    const roundState: RoundState = {
      round,
      review: {
        round,
        timestamp: new Date().toISOString(),
        findings,
        toolsUsed: reviewResult.toolsUsed,
        rawOutputPath,
      },
      humanFeedback: triageResult?.humanFeedback,
      actionableFindings: actionable,
      revision,
    };
    state.rounds.push(roundState);
    state.updatedAt = new Date().toISOString();

    // 11. 状態を永続化
    await persistState(state, config.paths.runDir);
  }

  // maxRounds到達
  if (state.status === "in_progress") {
    state.status = "stopped";
    state.stopReason = "max_rounds";
  }

  await persistState(state, config.paths.runDir);
  return state;
};
```

#### 人間ゲート判定ロジック

```typescript
const needsHumanGate = (
  round: number,
  activeFindings: Finding[],
  state: LoopState,
  config: PlanloopConfig,
): boolean => {
  // 初回は必ず人間triage
  if (round === 1 && config.policy.requireHumanOnFirstRound) {
    return true;
  }
  // 新規HIGH severity findingがある場合
  if (config.policy.requireHumanOnNewHighSeverity) {
    const previousFingerprints = new Set(
      state.rounds.flatMap((r) => r.review.findings.map((f) => f.fingerprint)),
    );
    const hasNewHigh = activeFindings.some(
      (f) => f.severity === "high" && !previousFingerprints.has(f.fingerprint),
    );
    return hasNewHigh;
  }
  return false;
};
```

#### 停滞判定ロジック

```typescript
const isStagnating = (
  state: LoopState,
  currentActionable: Finding[],
  threshold: number,
): boolean => {
  if (state.rounds.length < threshold) return false;

  const currentSet = new Set(currentActionable.map((f) => f.fingerprint));
  let consecutiveMatch = 0;

  for (let i = state.rounds.length - 1; i >= 0; i--) {
    const prevSet = new Set(
      state.rounds[i].actionableFindings.map((f) => f.fingerprint),
    );
    if (setsAreEqual(currentSet, prevSet)) {
      consecutiveMatch++;
    } else {
      break;
    }
  }

  return consecutiveMatch >= threshold;
};

const setsAreEqual = <T>(a: Set<T>, b: Set<T>): boolean => {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
};
```

#### 生出力の保存

```typescript
/**
 * アダプターが返した生出力テキストをファイルに保存し、パスを返す
 * ReviewAdapterResult.rawOutput → ReviewResult.rawOutputPath への変換を担う
 */
const saveRawOutput = async (
  runDir: string,
  runId: string,
  round: number,
  rawOutput: string,
): Promise<string> => {
  const dir = resolve(runDir, runId, `round-${round}`);
  await mkdir(dir, { recursive: true });
  const filePath = resolve(dir, "codex-raw.jsonl");
  await writeFile(filePath, rawOutput, "utf-8");
  return filePath;
};
```

#### 状態永続化

```typescript
const persistState = async (
  state: LoopState,
  runDir: string,
): Promise<void> => {
  const dir = resolve(runDir, state.runId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
};
```

#### filterByBlockingCategories関数

```typescript
/**
 * blockingCategoriesに含まれるカテゴリのFindingのみを抽出する
 * トリアージ後（または人間ゲート不要時）に、最終的なblocking findingsを決定する
 */
const filterByBlockingCategories = (
  findings: RawFinding[],
  config: PlanloopConfig,
): RawFinding[] => {
  return findings.filter((f) =>
    config.policy.blockingCategories.includes(f.category),
  );
};
```

#### SIGINTハンドリング

triage中にユーザーがCtrl+Cを押した場合:

1. `process.on("SIGINT")` でシグナルをキャッチ
2. 現在のラウンドまでの状態を永続化
3. `state.status = "stopped"`, `state.stopReason = "human_abort"` を設定
4. 状態ファイルに書き込んでからプロセスを終了

#### getPreviousFindings ヘルパー

```typescript
/**
 * 過去のラウンドの全Findingを取得する
 */
const getPreviousFindings = (state: LoopState): Finding[] => {
  return state.rounds.flatMap((r) => r.review.findings);
};
```

#### RunId生成

```typescript
// ISO 8601形式のタイムスタンプからファイルシステムセーフなIDを生成
const generateRunId = (): string => {
  return new Date().toISOString().replace(/[:.]/g, "-"); // 例: "2026-03-28T21-40-00-000Z"
};
```

#### 入力ファイルの検証

```typescript
import { access } from "node:fs/promises";
import { extname } from "node:path";

const validateInputFiles = async (
  planFile: string,
  promptFile: string,
): Promise<void> => {
  try {
    await access(planFile);
  } catch {
    throw new Error(`実装計画ファイルが見つかりません: ${planFile}`);
  }
  try {
    await access(promptFile);
  } catch {
    throw new Error(`プロンプトファイルが見つかりません: ${promptFile}`);
  }
  // Markdown以外のファイルは警告のみ（エラーにはしない）
  for (const file of [planFile, promptFile]) {
    if (extname(file) !== ".md") {
      console.warn(`警告: ${file} はMarkdownファイルではありません`);
    }
  }
};
```

#### テスト項目 (src/core/loop-runner.test.ts)

- 1ラウンドでblocking finding 0件 → 即座にcompleted
- 複数ラウンドの正常なループ実行
- 初回の人間ゲート発動
- 新規HIGH finding時の人間ゲート発動
- 停滞判定でのループ停止
- maxRounds到達でのループ停止
- Waiver ruleの累積適用
- 状態永続化の正確性
- filterByBlockingCategoriesの判定
- 自然言語トリアージ後のadjustedFindingsの反映
- トリアージでフィードバック空の場合（全指摘受け入れ）
- humanFeedbackのラウンド状態への記録
- 入力ファイル不存在時のエラー
- SIGINT時の状態保存
- エビデンス検証結果の表示（required充足/未充足、suggested警告）
- エビデンスrequired未充足時のユーザー確認プロンプト

> 注: テストではReviewAdapter / RevisionAdapterをモックとして注入

### 7.9 Codexレビュープロンプト生成 (src/prompts/codex-review.ts)

#### 責務

- Codexに渡すレビュープロンプトを生成する
- 前ラウンドのwaiver情報を含める

#### 公開関数

```typescript
import type { PlanloopConfig } from "../types/index.js";
import type { ReviewContext } from "../adapters/types.js";

export const generateCodexReviewPrompt = (
  planContent: string,
  promptContent: string,
  context: ReviewContext,
  config: PlanloopConfig,
): string;
```

#### プロンプトテンプレート

````markdown
あなたは実装計画のレビュアーです。以下の実装計画をレビューしてください。

## レビュー対象の実装計画

{planContent}

## 実装計画の元となった要件（プロンプト）

{promptContent}

## レビュー指示

1. 以下の観点でレビューを行ってください:
   {config.review.perspectives を1行ずつ " - " 付きで出力}

{config.review.additionalInstructions が設定されている場合のみ出力:} 2. 追加指示:
{config.review.additionalInstructions}

{最後に固定で出力:} 3. 以下の種類の指摘は避けてください:

- speculative_future: 「将来必要になるかもしれない」だけの指摘
- unnecessary_fallback: 不要なフォールバック実装の要求

{waiverSection}

## 出力形式

以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください。

```json
{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明（複数行可）",
      "severity": "high | medium | low",
      "category": "correctness | spec_mismatch | missing_acceptance_criteria | migration_risk | security | performance | code_quality | other"
    }
  ]
}
```
````

````

#### waiver sectionの生成

前ラウンドでwaive-ruleが設定されている場合:

```markdown
## 前回のレビューでの調整事項

以下の観点は前回のレビューで対象外と判断されています。これらに該当する指摘は出力しないでください。

{waiver.forEach: "- {waiver.reason} (カテゴリ: {waiver.category}, パターン: {waiver.match})"}
````

#### テスト項目 (src/prompts/codex-review.test.ts)

- 基本的なプロンプト生成（デフォルトのレビュー観点が含まれること）
- カスタムレビュー観点の反映（config.review.perspectivesの内容がプロンプトに含まれること）
- additionalInstructionsありの場合のセクション含有
- additionalInstructionsなしの場合のセクション省略
- waiver情報なしの場合のwaiver section省略
- waiver情報ありの場合のwaiver section含有
- planContent / promptContentの正確な埋め込み
- フィードバック付き再レビュープロンプト（`generateCodexFeedbackReviewPrompt`）の生成
- フィードバック付きプロンプトに初回findingsが正しく含まれること
- フィードバック付きプロンプトに人間のフィードバックが正しく含まれること

#### フィードバック付き再レビュープロンプト生成

```typescript
import type { RawFinding } from "../types/index.js";
import type { FeedbackReviewContext } from "../adapters/types.js";

/**
 * 人間のフィードバックを踏まえた再レビュー用プロンプトを生成する
 * reviewWithFeedback メソッドで使用する
 */
export const generateCodexFeedbackReviewPrompt = (
  planContent: string,
  promptContent: string,
  context: FeedbackReviewContext,
  config: PlanloopConfig,
): string;
```

#### フィードバック付き再レビュープロンプトテンプレート

```markdown
あなたは実装計画のレビュアーです。前回のレビューに対して人間からフィードバックがあったため、調整後のレビュー結果を出力してください。

## レビュー対象の実装計画

{planContent}

## 実装計画の元となった要件（プロンプト）

{promptContent}

## 前回のレビュー指摘

{context.originalFindings.forEach: "### {finding.id} [{finding.severity}] {finding.category}\n{finding.summary}\n{finding.detail}"}

## 人間からのフィードバック

{context.humanFeedback}

## 指示

上記のフィードバックを踏まえ、以下の条件で再レビューしてください:

1. waiveまたは対象外と指示された指摘は含めないでください
2. フィードバックで修正方針が示された指摘は、その方針を反映して調整してください
3. フィードバックで言及されていない指摘はそのまま残してください
4. 新たに気づいた指摘があれば追加してください

## 出力形式

（初回レビューと同じJSON形式）
```

### 7.10 Claude修正プロンプト生成 (src/prompts/claude-revision.ts)

#### 責務

- Claude Codeに渡す修正プロンプトを生成する
- triage済みのblocking findingsのみを含める

#### 公開関数

```typescript
export const generateClaudeRevisionPrompt = (
  planFile: string,
  promptFile: string,
  findings: Finding[],
): string;
```

#### プロンプトテンプレート

````markdown
以下の実装計画に対するレビュー指摘を反映してください。

## 対象ファイル

実装計画: {planFile}
元の要件: {promptFile}

## 反映すべきレビュー指摘

{findings.forEach: "### {finding.id} [{finding.severity}] {finding.category}\n{finding.summary}\n{finding.detail}"}

## 指示

1. 上記の指摘内容を実装計画ファイル（{planFile}）に反映してください
2. 実装計画ファイルを直接編集してください
3. 元の要件（{promptFile}）の内容に矛盾しないように注意してください
4. 反映結果を以下のJSON形式で標準出力に出力してください

```json
{
  "reflectedFindings": ["finding-1", "finding-2"],
  "summary": "変更内容の概要"
}
```
````

```

#### テスト項目 (src/prompts/claude-revision.test.ts)

- 基本的なプロンプト生成
- 複数Findingの正確なフォーマット
- ファイルパスの正確な埋め込み

### 7.11 CLIエントリポイント (src/bin/planloop.ts)

#### 責務
- commander.jsベースのCLI定義
- サブコマンドのルーティング

#### コマンド体系

```

planloop run --plan <file> --prompt <file> # レビューループを実行
planloop status [--run <run-id>] # ループの状態を表示
planloop init # デフォルト設定ファイルを生成

````

#### 実装

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { createCodexCliAdapter } from "../adapters/codex-cli.js";
import { createClaudeCliAdapter } from "../adapters/claude-cli.js";
import { runLoop } from "../core/loop-runner.js";

const program = new Command();

program
  .name("planloop")
  .description("AIコーディングエージェントが作成した実装計画のレビューループを自動化するCLIツール")
  .version("0.1.0");

program
  .command("run")
  .description("レビューループを実行する")
  .requiredOption("--plan <file>", "レビュー対象の実装計画ファイル")
  .requiredOption("--prompt <file>", "実装計画の元となったプロンプトファイル")
  .action(async (options) => {
    const config = await loadConfig(process.cwd());
    const reviewAdapter = createCodexCliAdapter(config);
    const revisionAdapter = createClaudeCliAdapter(config);

    const result = await runLoop({
      planFile: options.plan,
      promptFile: options.prompt,
      config,
      reviewAdapter,
      revisionAdapter,
    });

    displayResult(result, process.stdout);
  });

program
  .command("status")
  .description("ループの状態を表示する")
  .option("--run <run-id>", "表示するランのID（省略時は最新）")
  .action(async (options) => {
    // 1. config.paths.runDir からrunディレクトリ一覧を取得
    // 2. --run 指定時はそのID、省略時は最新のstate.jsonを読み込む
    // 3. displayResult() で状態を表示
    // 最新runの判定: ディレクトリ名（ISO 8601ベース）のソートで最新を取得
  });

program
  .command("init")
  .description("デフォルト設定ファイルと.gitignoreエントリを生成する")
  .action(async () => {
    // 1. .planloop/ ディレクトリを作成
    // 2. .planloop/config.yml をデフォルト値で生成（既存なら上書きしない）
    // 3. .planloop/runs/ ディレクトリを作成
    // 4. .gitignore に .planloop/runs/ が含まれていなければ追記
  });

program.parse();
````

#### テスト項目の改修 (src/bin/planloop.test.ts)

既存テスト（バージョン情報出力）に加えて:

- `planloop --help` でヘルプメッセージが表示される
- `planloop run --help` でrunコマンドのヘルプが表示される
- `planloop run` で `--plan` / `--prompt` 未指定時のエラー
- `planloop init` でデフォルト設定ファイルが生成される

### 7.12 結果サマリー表示 (src/display/result.ts)

#### 責務

- ループ完了後の結果をターミナルに表示する

#### 公開関数

```typescript
/**
 * ループ完了結果をターミナルに表示する
 */
export const displayResult = (
  state: LoopState,
  stdout: NodeJS.WritableStream,
): void;
```

#### 表示内容

```
════════════════════════════════════════
  planloop 完了
════════════════════════════════════════
  ステータス: completed (no_blocking_findings)
  ラウンド数: 3
  実行時間:   2026-03-28T21:40:00Z ~ 2026-03-28T21:55:00Z
  適用Waiver: 2件
────────────────────────────────────────
  ラウンド別サマリー:
    Round 1: 7件 → triage → 3件blocking → Claude修正
    Round 2: 2件 → auto   → 1件blocking → Claude修正
    Round 3: 0件 → 完了
────────────────────────────────────────
  状態ファイル: .planloop/runs/2026-03-28T21-40-00-000Z/state.json
════════════════════════════════════════
```

- ステータスに応じてpicolorsで色分け:
  - `completed` → 緑
  - `stopped (stagnation)` → 黄
  - `stopped (max_rounds)` → 黄
  - `stopped (human_abort)` → 赤

### 7.13 リアルタイム進捗表示 (src/display/stream-renderer.ts)

#### 責務

- Codex/Claude Codeの実行状況をリアルタイムでターミナルに表示する
- JSONLストリーム（Codex `--json`）およびstream-JSON（Claude `--output-format stream-json`）をパースし、人間が読める形式でレンダリングする

#### 公開関数

```typescript
import type { ChildProcess } from "node:child_process";

/**
 * 子プロセスのstdoutストリームをリアルタイムでターミナルに表示する
 * @param childProcess spawn済みの子プロセス
 * @param label 表示ラベル（例: "Codex レビュー", "Claude Code 修正"）
 * @param format ストリームのフォーマット
 * @returns ストリーム終了時に全出力を返すPromise
 */
export const renderStream = (
  childProcess: ChildProcess,
  label: string,
  format: "codex-jsonl" | "claude-stream-json",
): Promise<string>;
```

#### Codex JSONL ストリームの表示

Codexの `--json` 出力から主要イベントを抽出し、以下の形式でリアルタイム表示する:

```
═══ Round 1: Codex レビュー実行中 ═══
  🔍 [tool] gh issue view 3 --repo nekochans/planloop
  🔍 [tool] context7: querying commander.js docs
  💬 レビュー観点を確認中...
  📋 Finding 1: API endpoint path mismatch (HIGH)
  📋 Finding 2: Missing error handling (MEDIUM)
  📋 Finding 3: Pagination not considered (LOW)
  ✓ レビュー完了: 3件の指摘
```

表示対象のJSONLイベント:

- `command_execution` → `🔍 [tool] <command>` として表示
- `mcp_tool_call` → `🔍 [tool] <tool_name>` として表示
- `message` (role: assistant) → 内容に "finding" や指摘を含む場合は `📋` 、それ以外は `💬` として表示

#### Claude stream-JSON ストリームの表示

Claude CLIの `--output-format stream-json` 出力をパースし、以下の形式で表示する:

```
═══ Round 1: Claude Code 修正中 ═══
  📖 [Read] design-docs-for-ai/issue3-plan.md
  ✏️  [Edit] design-docs-for-ai/issue3-plan.md
  💬 finding-1を反映: APIパスを修正
  ✏️  [Edit] design-docs-for-ai/issue3-plan.md
  💬 finding-2を反映: エラーハンドリングを追加
  ✓ 修正完了
```

表示対象のstream-JSONイベント:

- ツール使用イベント（Read, Edit, Glob等） → ツール名とパラメータを表示
- テキスト出力イベント → Claude の応答テキストを表示

#### テスト項目 (src/display/stream-renderer.test.ts)

- Codex JSONL形式の正しいパースと表示
- Claude stream-JSON形式の正しいパースと表示
- 不正なJSONL行のスキップ（エラーにならないこと）
- 空のストリームでのハンドリング
- 全出力の収集と返却

### 7.14 途中介入ハンドラー (src/intervention/handler.ts)

#### 責務

- ループ実行中にユーザーのキー入力を監視する
- 介入キーが押された場合、実行中の子プロセスを中断し、ユーザーに選択肢を提示する

#### 公開関数

```typescript
/**
 * 途中介入の監視を開始する
 * @param onIntervene 介入時のコールバック
 * @returns 監視を停止するための関数
 */
export const startInterventionMonitor = (
  onIntervene: () => Promise<InterventionAction>,
): StopMonitor;

export type InterventionAction =
  | "abort"        // このラウンドを破棄してループを終了
  | "retry"        // このラウンドを破棄してやり直す
  | "continue";    // 中断を取り消して続行

export type StopMonitor = () => void;
```

#### 介入フロー

1. **キー入力監視**: `process.stdin` をrawモードに設定し、キー入力を監視する
2. **介入キー**: `q` キーを押すと介入モードに入る
3. **子プロセス停止**: 実行中の `codex` / `claude` 子プロセスに `SIGTERM` を送信
4. **選択肢表示**:

```
⚠ 介入を検出しました。実行中のプロセスを停止しました。

  [A] 中断して終了   — このラウンドの結果を破棄し、ここまでの状態を保存して終了
  [R] やり直し       — このラウンドを最初からやり直す
  [C] 続行           — 中断を取り消して処理を続行（プロセスは再開されます）
> _
```

5. **アクション実行**:
   - `A` (abort): `state.stopReason = "human_abort"` で状態を保存してループ終了
   - `R` (retry): 現在のラウンドを破棄し、同じラウンド番号で再実行
   - `C` (continue): 子プロセスを再起動して処理を続行

#### ループランナーとの統合

```typescript
// loop-runner.ts 内での使用例
const stopMonitor = startInterventionMonitor(async () => {
  // 実行中の子プロセスを停止
  currentChildProcess?.kill("SIGTERM");
  // ユーザーに選択肢を提示
  return await promptInterventionAction(options.stdin, options.stdout);
});

try {
  // ラウンド実行...
} finally {
  stopMonitor(); // 監視停止（stdinのrawモードを元に戻す）
}
```

#### 注意事項

- rawモードは対話型トリアージ（エディタ起動）中は無効にする必要がある（エディタがstdinを使うため）
- `--no-tty` のようなオプションで介入機能を無効にできるようにする（CI/CD環境等での利用を想定）
- `process.stdin.isTTY` が `false` の場合（パイプ接続等）は自動的に介入機能を無効にする

#### テスト項目 (src/intervention/handler.test.ts)

- `q` キー入力での介入モード発動
- 各アクション（A/R/C）の正しい処理
- rawモードの設定と解除
- TTYでない環境での自動無効化
- エディタ起動中の監視一時停止

> 注: テストでは `process.stdin` をモックし、キー入力をシミュレートする

### 7.15 エビデンス検証 (src/evidence/)

#### 7.15.1 エビデンス要件分析器 (src/evidence/analyzer.ts)

##### 責務

- prompt / plan の内容を静的解析し、案件ごとに「必須確認（requiredEvidence）」と「推奨確認（suggestedEvidence）」を組み立てる
- URL パターンやキーワードに基づいて、どの情報源への確認が期待されるかを判定する

##### 設計思想

レビューで「関連情報を必ず確認する」を機械的に保証するには、案件ごとに期待される確認先を事前に特定する必要がある。全案件で一律にチェックするのではなく、prompt / plan の内容から動的に期待値を立てることで、過不足のない検証を実現する。

##### 公開関数

```typescript
import type { EvidenceRequirement } from "../types/index.js";

export type EvidenceAnalysisResult = {
  required: EvidenceRequirement[];
  suggested: EvidenceRequirement[];
};

/**
 * prompt / plan の内容を静的解析し、エビデンス要件を抽出する
 * @param planContent 実装計画の内容
 * @param promptContent プロンプトの内容
 * @returns 必須確認と推奨確認の要件リスト
 */
export const analyzeEvidenceRequirements = (
  planContent: string,
  promptContent: string,
): EvidenceAnalysisResult;
```

##### 抽出ルール

| 検出パターン                                                              | 情報源         | 分類          | matchPatterns                     |
| ------------------------------------------------------------------------- | -------------- | ------------- | --------------------------------- |
| GitHub Issue/PR URL（`github.com/.../issues/N`, `github.com/.../pull/N`） | `gh`           | **required**  | `["gh issue", "gh pr"]`           |
| `gh issue view`, `gh pr view` 等のコマンド言及                            | `gh`           | **required**  | `["gh issue", "gh pr"]`           |
| Figma URL（`figma.com/`）                                                 | `figma_mcp`    | **required**  | `["figma"]`                       |
| ライブラリ名の言及 + バージョン確認の指示                                 | `context7_mcp` | **suggested** | `["context7", "resolve-library"]` |
| 「ドキュメントで確認」「公式ドキュメント」等の指示                        | `context7_mcp` | **suggested** | `["context7", "resolve-library"]` |
| 「Web検索」「Web で確認」等の指示                                         | `web_search`   | **suggested** | `["web_search", "search"]`        |

##### 処理フロー

1. `planContent` と `promptContent` を結合してテキストを走査
2. 正規表現で GitHub URL / Figma URL を検出 → `required` に追加
3. 「ドキュメントで確認」等のキーワードを検出 → `suggested` に追加
4. 重複を除去して返す

##### テスト項目 (src/evidence/analyzer.test.ts)

- GitHub Issue URLを含むplanからの `gh` required検出
- GitHub PR URLを含むpromptからの `gh` required検出
- Figma URLを含むplanからの `figma_mcp` required検出
- ライブラリ言及からの `context7_mcp` suggested検出
- URL/キーワードが一切ない場合の空配列返却
- 複数の情報源が同時に検出される場合

#### 7.15.2 エビデンス検証器 (src/evidence/verifier.ts)

##### 責務

- Codex実行後の `toolsUsed` リストとエビデンス要件を照合し、検証結果を返す
- `required` の未充足はエラー（ループ続行前にユーザーに警告）
- `suggested` の未充足は警告のみ

##### 公開関数

```typescript
import type { EvidenceRequirement, EvidenceVerificationResult } from "../types/index.js";

/**
 * toolsUsedとエビデンス要件を照合する
 * @param toolsUsed Codex実行中に使用されたツールのリスト
 * @param required 必須エビデンス要件
 * @param suggested 推奨エビデンス要件
 * @returns 検証結果
 */
export const verifyEvidence = (
  toolsUsed: string[],
  required: EvidenceRequirement[],
  suggested: EvidenceRequirement[],
): EvidenceVerificationResult;
```

##### 照合ロジック

1. 各 `EvidenceRequirement` の `matchPatterns` を `toolsUsed` の各要素に対して部分一致で検索
2. 1つでもマッチすれば `satisfied: true`、マッチしたツール名を `matchedTools` に記録
3. 全 `required` が satisfied なら `allRequiredSatisfied: true`

##### 検証結果の表示

```
═══ エビデンス検証結果 ═══
  ✓ [必須] GitHub Issue/PR の確認 — gh issue view 3
  ✓ [推奨] ライブラリドキュメントの確認 — context7: querying commander.js
  ✗ [推奨] Web検索 — 未実行（推奨のため続行）
```

`allRequiredSatisfied` が `false` の場合:

```
⚠ [必須] GitHub Issue/PR の確認 — 未実行
  必須エビデンスが不足しています。レビュー結果の信頼性が低い可能性があります。
  続行しますか？ [Y/n]
```

> 注: `required` 未充足時はユーザーに確認を求める（自動中断ではなく、判断は人間に委ねる）。これは、ツール名の部分一致による検出には誤検知の可能性があり、実際にはストリーミング表示で確認できている場合もあるため。

##### テスト項目 (src/evidence/verifier.test.ts)

- 全required/suggested充足時のallRequiredSatisfied: true
- required未充足時のallRequiredSatisfied: false
- matchPatternsの部分一致検出（`gh issue view` → `gh issue` にマッチ）
- toolsUsedが空の場合
- required/suggestedが空の場合（スキップ）
- 複数のmatchPatternsで1つでもマッチすればsatisfied

## 8. 停止条件の詳細

| 条件                 | 判定方法                                              | LoopState.stopReason   |
| -------------------- | ----------------------------------------------------- | ---------------------- |
| Blocking findingなし | `actionableFindings.length === 0`                     | `no_blocking_findings` |
| 停滞                 | 同一fingerprint集合が `stagnationRounds` ラウンド連続 | `stagnation`           |
| 最大ラウンド到達     | `round >= maxRounds`                                  | `max_rounds`           |
| 人間による中断       | triage中のCtrl+C                                      | `human_abort`          |

## 9. テスト計画

### 9.1 単体テスト

| モジュール              | テストファイル                  | 主なテスト内容                                     |
| ----------------------- | ------------------------------- | -------------------------------------------------- |
| config/loader           | config/loader.test.ts           | 設定ファイル読み込み、デフォルト値、バリデーション |
| adapters/codex-cli      | adapters/codex-cli.test.ts      | Codex CLI呼び出し、出力パース、エラーハンドリング  |
| adapters/claude-cli     | adapters/claude-cli.test.ts     | Claude CLI呼び出し、出力パース、エラーハンドリング |
| core/fingerprint        | core/fingerprint.test.ts        | フィンガープリント生成の安定性・一意性             |
| core/waiver             | core/waiver.test.ts             | Waiverマッチング、カテゴリフィルタ                 |
| core/triage             | core/triage.test.ts             | 対話型UI、各アクションの処理                       |
| core/loop-runner        | core/loop-runner.test.ts        | ループ全体の統合テスト（アダプターモック）         |
| prompts/codex-review    | prompts/codex-review.test.ts    | プロンプト生成                                     |
| prompts/claude-revision | prompts/claude-revision.test.ts | プロンプト生成                                     |
| display/stream-renderer | display/stream-renderer.test.ts | JSONL/stream-JSONのパースとレンダリング            |
| evidence/analyzer       | evidence/analyzer.test.ts       | prompt/planからのエビデンス要件抽出                |
| evidence/verifier       | evidence/verifier.test.ts       | toolsUsedとエビデンス要件の照合                    |
| intervention/handler    | intervention/handler.test.ts    | キー入力監視、介入アクション処理                   |

### 9.2 テスト方針

- **アダプターテスト**: `child_process.spawn` をモックし、CLI出力のパースロジックを検証
- **ループランナーテスト**: ReviewAdapter / RevisionAdapterをモックとして注入し、ループロジックのみを検証
- **トリアージテスト**: stdin/stdoutをモックストリームで代替し、対話ロジックを検証
- **テストデータ**: `src/__fixtures__/` に共通のテストデータを配置:
  - `src/__fixtures__/sample-findings.ts` — テスト用Findingファクトリー関数（severity/categoryの各パターン）
  - `src/__fixtures__/sample-config.ts` — テスト用PlanloopConfigのデフォルト値
  - `src/__fixtures__/codex-output-valid.jsonl` — 正常なCodex JSONL出力サンプル
  - `src/__fixtures__/codex-output-malformed.jsonl` — 不正なCodex出力のテスト用サンプル
  - `src/__fixtures__/sample-plan.md` — テスト用の実装計画Markdownファイル
  - `src/__fixtures__/sample-prompt.md` — テスト用のプロンプトMarkdownファイル

## 10. 実装順序

実装は依存関係の浅い順に進める。各ステップでテストを先に書き、実装後にパスすることを確認する。

### Phase 1: 基盤（依存ライブラリ + 型定義 + インターフェース）

1. **依存ライブラリのインストール**
   - `npm install commander zod yaml picocolors`
2. **型定義の作成** (`src/types/index.ts`)
   - 全型定義・定数を作成
3. **アダプターインターフェース** (`src/adapters/types.ts`)
   - ReviewAdapter / RevisionAdapterのインターフェース定義（型定義のみに依存）
4. **設定スキーマの作成** (`src/config/schema.ts`)
   - Zodスキーマ定義
5. **設定ローダーの作成** (`src/config/loader.ts` + テスト)
   - 設定ファイル読み込みロジック
6. **テストフィクスチャの作成** (`src/__fixtures__/`)
   - 共通テストデータの準備

### Phase 2: プロンプトテンプレート

7. **Codexレビュープロンプト** (`src/prompts/codex-review.ts` + テスト)
8. **Claude修正プロンプト** (`src/prompts/claude-revision.ts` + テスト)

### Phase 3: コアロジック

9. **フィンガープリント** (`src/core/fingerprint.ts` + テスト)
10. **Waiverマッチング** (`src/core/waiver.ts` + テスト)
11. **対話型トリアージ** (`src/core/triage.ts` + テスト)

### Phase 4: アダプター

12. **Codex CLIアダプター** (`src/adapters/codex-cli.ts` + テスト)
13. **Claude CLIアダプター** (`src/adapters/claude-cli.ts` + テスト)

### Phase 5: エビデンス検証

14. **エビデンス要件分析器** (`src/evidence/analyzer.ts` + テスト)
    - prompt/planの静的解析、requiredEvidence/suggestedEvidence の抽出
15. **エビデンス検証器** (`src/evidence/verifier.ts` + テスト)
    - toolsUsedとエビデンス要件の照合

### Phase 6: リアルタイム表示・途中介入

16. **リアルタイム進捗表示** (`src/display/stream-renderer.ts` + テスト)
    - Codex JSONL / Claude stream-JSON のパースとレンダリング
17. **途中介入ハンドラー** (`src/intervention/handler.ts` + テスト)
    - キー入力監視、子プロセス停止、選択肢表示

### Phase 7: 統合

18. **結果サマリー表示** (`src/display/result.ts` + テスト)
19. **ループランナー** (`src/core/loop-runner.ts` + テスト)
    - renderStream / interventionHandler / evidenceVerifier との統合
20. **CLIエントリポイント改修** (`src/bin/planloop.ts` + テスト改修)

### Phase 8: ドキュメント

21. **README.md の更新**
    - 以下の内容を追記する:
      - 新しいCLIコマンドの使い方（`planloop run`、`planloop status`、`planloop init`）
      - 前提条件（Claude Code CLI / Codex CLIのインストールと認証）
      - `.planloop/config.yml` の設定方法（レビュー観点のカスタマイズ方法を含む）
      - 基本的なワークフロー（init → run → 結果確認）の説明
      - ディレクトリ構成の更新

### Phase 9: 品質管理

22. 品質管理手順の実行（後述）

## 11. 品質管理手順

全ての実装完了後、以下の手順を順番に実施する。1つでも異常終了した場合は、問題点を修正してエラーが出なくなるまで修正を繰り返す。

1. `npm run format` — Formatterの適用
2. `npm run lint` — Linterエラーがないことを確認
3. `npm run test` — テストコードの実行（全テストがパスすること）
4. `npm run build` — ビルドが正常終了することを確認
