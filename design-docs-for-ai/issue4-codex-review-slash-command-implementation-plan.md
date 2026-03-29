# Issue #4: Claude Codeスキルとしてのレビューループ実装（/codex-review）

## Context

Issue #3 で実装したスタンドアロンCLI方式（`planloop run`）の実機テストで以下の問題が判明した:

- 毎ラウンドの人間トリアージがファイル編集ベースで重い
- Codex/Claude共にfresh run（`--ephemeral` / `--no-session-persistence`）のため前回の文脈を覚えていない
- 途中で止められない（独立プロセスのため）
- 3つのCLI（planloop → codex → claude）をファイルで中継する構成が本質的に重い

Claude Codeのスキルとして再実装することで、トリアージが自然な会話になり、Claude Code自身が修正し、途中で止められ、文脈が保持される。

---

## 作成するファイル

| # | ファイルパス | 用途 |
|---|---|---|
| 1 | `.claude/skills/codex-review/codex-review-output.json` | Codex構造化出力用JSON Schema |
| 2 | `.claude/skills/codex-review/SKILL.md` | スキル定義本体 |

**TypeScriptの変更は一切不要。** 既存の `src/` 配下のコードはそのまま維持する。

> 注: Claude Code の現行ドキュメントでは custom commands は skills に統合されている。`.claude/commands/*.md` は引き続き動作するが、新規実装は `.claude/skills/` 配下が推奨。skills はスキル本体（`SKILL.md`）と補助ファイル（JSON Schema等）を同一ディレクトリに同居させられるため、管理しやすい。

### ディレクトリ作成

`.claude/skills/codex-review/` ディレクトリは現在存在しないため、ファイル作成前に作成が必要:

```bash
mkdir -p .claude/skills/codex-review
```

---

## ファイル1: `.claude/skills/codex-review/codex-review-output.json`

`src/adapters/codex-cli.ts:39-86` の `OUTPUT_SCHEMA` をそのまま静的JSONファイルとして切り出す。`codex exec --output-schema` に渡すために使用する。スキル定義（`SKILL.md`）と同一ディレクトリに配置する。

### 内容

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["findings"],
  "additionalProperties": false,
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "summary", "detail", "severity", "category", "lineRef"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "summary": { "type": "string" },
          "detail": { "type": "string" },
          "severity": {
            "type": "string",
            "enum": ["high", "medium", "low"]
          },
          "category": {
            "type": "string",
            "enum": [
              "correctness", "spec_mismatch", "missing_acceptance_criteria",
              "migration_risk", "speculative_future", "unnecessary_fallback",
              "code_quality", "security", "performance", "other"
            ]
          },
          "lineRef": { "type": ["string", "null"] }
        }
      }
    }
  }
}
```

### 設計ポイント
- `additionalProperties: false` — Codexが余計なフィールドを出力するのを防ぐ
- `lineRef` は `type: ["string", "null"]` — 行参照がない場合の `null` を許容
- 元コード参照: `src/adapters/codex-cli.ts:39-86`

---

## ファイル2: `.claude/skills/codex-review/SKILL.md`

スキル定義本体。Claude Codeが `/codex-review plan.md prompt.md` 実行時にこのMarkdownをプロンプトとして読み込み、指示に従って動作する。

`SKILL.md` の先頭には以下の frontmatter を含める:

```yaml
---
name: codex-review
description: Codex CLIで実装計画レビューの改善ループを回す
disable-model-invocation: true
---
```

- `disable-model-invocation: true` — ユーザーが `/codex-review` で明示的に呼び出した場合のみ実行される（Claude Codeが自動判断で呼び出すことを防止）

### スキル定義の全体構造

以下の「セクション1〜6」は設計仕様（各要素の設計根拠と詳細説明）である。**実装時に作成するファイルの実際の内容は、本計画の後半「`.claude/skills/codex-review/SKILL.md` の完全なテンプレート」セクションに記載している。**

---

### セクション1: ヘッダーと引数

```markdown
# /codex-review — Codexによる実装計画レビューループ

Codex CLIを使って実装計画をレビューし、指摘→修正の改善ループを回します。

## 引数

`$ARGUMENTS` を空白で分割し、第1引数を `planFile`、第2引数を `promptFile` として使用してください。
```

- `$ARGUMENTS` はClaude Codeが自動で置換する
- ユーザーは `/codex-review design-docs-for-ai/plan.md user-prompt/prompt.md` のように入力

---

### セクション2: 前提条件と初期セットアップ

Claude Codeに以下を実行させる:

1. **引数のパース**: `$ARGUMENTS` を空白分割して `planFile` と `promptFile` を取得
2. **ファイル存在確認**: Readツールで両ファイルを読み込み、存在を確認
3. **設定読み込み**: `.planloop/config.yml` が存在すればReadツールで読み込み、YAMLをパース。存在しなければデフォルト値を使用

**デフォルト設定値**（`src/config/schema.ts` より）:

```yaml
maxRounds: 8
stagnationRounds: 2
blockingCategories:
  - correctness
  - spec_mismatch
  - missing_acceptance_criteria
  - migration_risk
autoWaiveCategories:
  - speculative_future
  - unnecessary_fallback
requireHumanOnFirstRound: true
requireHumanOnNewHighSeverity: true
perspectives:
  - "correctness: 実装計画の内容が要件と一致しているか"
  - "spec_mismatch: 仕様との不一致がないか"
  - "missing_acceptance_criteria: 受け入れ基準の漏れがないか"
  - "migration_risk: マイグレーションリスクがないか"
  - "security: セキュリティ上の懸念がないか"
  - "performance: パフォーマンス上の懸念がないか"
```

4. **状態変数の初期化**:
   - `currentRound = 1`
   - `accumulatedWaivers = []`（セッション内で蓄積するwaiver rule）
   - `previousFingerprintSets = []`（停滞検出用）

---

### セクション3: メインループ

以下のステップを `currentRound <= maxRounds` の間繰り返す。

---

#### ステップ3.1: Codexレビュープロンプトの構築

Claude Codeが `planFile` と `promptFile` の内容を使い、以下のテンプレートでCodexレビュープロンプトを構築する。

**初回レビュープロンプト**（`src/prompts/codex-review.ts:7-59` の `generateCodexReviewPrompt()` を再現）:

```
あなたは実装計画のレビュアーです。以下の実装計画をレビューしてください。

## レビュー対象の実装計画

{planFileの内容}

## 実装計画の元となった要件（プロンプト）

{promptFileの内容}

## レビュー指示

1. 以下の観点でレビューを行ってください:
   - {perspectives[0]}
   - {perspectives[1]}
   - ...

2. 以下の種類の指摘は避けてください:
   - speculative_future: 「将来必要になるかもしれない」だけの指摘
   - unnecessary_fallback: 不要なフォールバック実装の要求

{additionalInstructions — config.review.additionalInstructionsが設定されていれば追加:
 "3. 追加指示:\n{additionalInstructions}"}

{waiver section — accumulatedWaiversが空でなければ追加}

## 出力形式

以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください。

```json
{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明",
      "severity": "high | medium | low",
      "category": "correctness | spec_mismatch | missing_acceptance_criteria | migration_risk | security | performance | code_quality | other",
      "lineRef": null
    }
  ]
}
```
```

**Waiverセクション**（waiver がある場合のみ追加、`src/prompts/codex-review.ts:120-139` の `buildWaiverSection()` を再現）:

```
## 前回のレビューでの調整事項

以下の観点は前回のレビューで対象外と判断されています。これらに該当する指摘は出力しないでください。

- {waiver.reason} (カテゴリ: {waiver.category ?? "全て"}, パターン: {waiver.match})
```

**再レビュープロンプト（Round 2+）**:

`codex exec resume <thread_id>` を使用するため、Codexには前回の会話コンテキストが残っている。プロンプトは以下の形式:

```
実装計画が修正されました。修正後の計画を改めてレビューしてください。

## 修正後の実装計画

{修正後のplanFileの内容}

## 修正内容の概要

{前ラウンドで修正した内容のサマリー}

## レビュー指示

前回と同じ観点でレビューし、残存する指摘があれば出力してください。
修正により解消された指摘は含めないでください。
新たに気づいた指摘があれば追加してください。

{waiver section — accumulatedWaiversが空でなければ追加}

## 出力形式（重要: 必ず以下のJSON形式で出力してください）

{同じJSON形式の説明}
```

**フィードバック反映プロンプト**（`src/prompts/codex-review.ts:62-118` の `generateCodexFeedbackReviewPrompt()` を再現）:

初回トリアージ後にユーザーフィードバックをCodexに渡す場合。**重要: 元実装と同様に `planContent` と `promptContent` を必ず含める。**

```
あなたは実装計画のレビュアーです。前回のレビューに対して人間からフィードバックがあったため、調整後のレビュー結果を出力してください。

## レビュー対象の実装計画

{planFileの内容}

## 実装計画の元となった要件（プロンプト）

{promptFileの内容}

## 前回のレビュー指摘

{各findingを "### finding-N [SEVERITY] category\nsummary\ndetail" 形式で列挙}

## 人間からのフィードバック

{ユーザーのフィードバックテキスト}

## 指示

上記のフィードバックを踏まえ、以下の条件で再レビューしてください:
1. waiveまたは対象外と指示された指摘は含めないでください
2. フィードバックで修正方針が示された指摘は、その方針を反映して調整してください
3. フィードバックで言及されていない指摘はそのまま残してください
4. 新たに気づいた指摘があれば追加してください

## 出力形式

以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください。

{同じJSON形式の説明}
```

---

#### ステップ3.2: Codex CLI実行

**セッション管理方針: `codex exec resume <thread_id>` による明示的セッション引き継ぎ**

Issue #3 では `codex exec resume --last` の脆弱性（誤セッション再開リスク）を理由に resume を不採用としたが、技術検証により **`thread_id` を明示指定する方式** で安全にセッション引き継ぎが可能であることを確認した。

**技術検証結果（2026-03-29, codex-cli 0.117.0）:**
- `codex exec --json` のJSONL出力の最初のイベント `thread.started` に `thread_id`（UUID）が含まれる
  ```json
  {"type":"thread.started","thread_id":"019d38c9-9806-7120-9666-bd68240f9ed5"}
  ```
- `codex exec resume <thread_id>` で明示的にセッションを指定して再開可能
- resume 時、Codex は前回の会話コンテキストを正しく引き継ぐ（`input_tokens` の増加で確認）
- **`codex exec resume` は `--output-schema` をサポートしない**（初回のみ利用可能）

**セッション管理フロー:**

1. 初回 `codex exec` 実行時にJSONLから `thread_id` を抽出・保持
2. 2回目以降は `codex exec resume <thread_id>` でセッションを再開
3. `--output-schema` は初回のみ使用。2回目以降はプロンプト内にJSON出力形式を明記して代替
4. resume 失敗時は fresh `codex exec`（`--output-schema` 付き）にフォールバック

**Round 1のCodex呼び出しフロー（最大2回のCodex呼び出し）:**

```
Round 1:
  (1) codex exec                      → 初回レビュー → findings取得 + thread_id保持
  (2) ユーザーにfindings表示           → トリアージフィードバック取得
  (3) codex exec resume <thread_id>   → フィードバック反映 → 調整後findings取得
  (4) Claude Code                      → 調整後findingsに基づいてplanFile修正

Round 2+:
  (1) codex exec resume <thread_id>   → 更新されたplanの再レビュー → findings取得
  (2) (新規HIGHがあれば)ユーザーに表示 → トリアージ
  (3) Claude Code                      → findingsに基づいてplanFile修正
```

**一時ファイルの命名規則:**

並行実行や再実行時の衝突を防ぐため、runごとに一意な一時ディレクトリを作成する:

```bash
PLANLOOP_TMPDIR=$(mktemp -d /tmp/planloop-run-XXXXXX)
```

以降、全ての一時ファイルはこのディレクトリ配下に配置する:
- `$PLANLOOP_TMPDIR/prompt.txt` — Codexへのプロンプト
- `$PLANLOOP_TMPDIR/codex-output.txt` — Codexの最終メッセージ（`-o` 出力）
- `$PLANLOOP_TMPDIR/codex-jsonl.txt` — CodexのJSONLイベント出力

**初回レビュー（Round 1, 呼び出し1回目）:**

```bash
cat "$PLANLOOP_TMPDIR/prompt.txt" | codex exec --json --full-auto \
  --output-schema .claude/skills/codex-review/codex-review-output.json \
  -o "$PLANLOOP_TMPDIR/codex-output.txt" - \
  2>&1 | tee "$PLANLOOP_TMPDIR/codex-jsonl.txt" > /dev/null
```

実行後、thread_id を抽出:
```bash
grep -o '"thread_id":"[^"]*"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | head -1 | sed 's/"thread_id":"//;s/"//'
```

- `--ephemeral` は**使用しない**（セッション保持のため）
- `--output-schema` で構造化出力を強制（**初回のみ使用可能**）
- `-o` で最終メッセージをファイルに保存（findingパース用）
- `--full-auto` は `workspace-write` sandbox + auto-approve のエイリアス
- JSONL出力は `tee` で `$PLANLOOP_TMPDIR/codex-jsonl.txt` にも保存（エビデンス検証 + thread_id抽出用）

**フィードバック反映 / 再レビュー（Round 1 呼び出し2回目 / Round 2+）:**

```bash
cat "$PLANLOOP_TMPDIR/prompt.txt" | codex exec resume "<thread_id>" \
  --json --full-auto \
  -o "$PLANLOOP_TMPDIR/codex-output.txt" - \
  2>&1 | tee "$PLANLOOP_TMPDIR/codex-jsonl.txt" > /dev/null
```

- `codex exec resume <thread_id>` で**明示的にセッションを指定**（`--last` は使用しない）
- **`--output-schema` は使用不可**（resume未対応）。プロンプト内にJSON出力形式を明記して代替
- `-o` で最終メッセージをキャプチャ
- セッション内で前回の文脈（レビュー観点、waiver、過去のfindings等）がCodexに保持される

**resume失敗時のフォールバック:**

`codex exec resume <thread_id>` がエラーになった場合（セッションが消失等）、fresh `codex exec`（`--output-schema` 付き、`--ephemeral` なし）にフォールバック。この場合はプロンプト内に前回の文脈（findings + feedback + 修正内容）を全て含める。

---

#### ステップ3.3: 結果パース

`$PLANLOOP_TMPDIR/codex-output.txt` をReadツールで読み取り、findingsを抽出する。

**パース戦略**（`src/adapters/codex-cli.ts:272-340` の `parseFindings()` + `extractJson()` を再現）:

1. JSONコードブロック（` ```json ... ``` `）内のJSONを抽出
2. なければ `{` から `}` までのJSON objectを抽出
3. `findings` 配列を取得
4. 各findingの必須フィールドを検証: `id`, `summary`, `detail`, `severity`, `category`
5. 有効なfindingsのみ採用（不正なエントリはスキップ）

**パース失敗時:** Claude Code自身がCodex出力のテキストを読み取り、findingsを手動で構造化する。

---

#### ステップ3.4: Waiver適用とフィルタリング

`src/core/waiver.ts` の `applyWaivers()` ロジックを再現:

**処理順序:**

1. **autoWaiveCategories チェック**: `speculative_future` / `unnecessary_fallback` カテゴリのfindingsを自動除外
2. **accumulatedWaivers マッチング**: 蓄積されたwaiver ruleと照合
   - waiver.category が設定されていれば、findingのcategoryと一致するか確認
   - `${finding.summary} ${finding.detail}` にwaiver.matchが含まれるか確認
   - マッチすればaction=ignoreなら除外、action=downgradeならnon_blocking扱い
3. **Blocking分類**: `blockingCategories`（correctness, spec_mismatch, missing_acceptance_criteria, migration_risk）に該当するfindingsのみblocking扱い

結果を3グループに分類:
- **blocking**: 修正が必要
- **non-blocking**: 参考情報として表示
- **waived**: 自動除外（件数のみ表示）

---

#### ステップ3.5: フィンガープリント生成と停滞検出

**フィンガープリント算出**（`src/core/fingerprint.ts` を再現）:

各findingに対して以下のBashコマンドで算出:

```bash
printf '%s' "category:$(echo 'summary text here' | tr '[:upper:]' '[:lower:]' | sed -E 's/[0-9]+/<NUM>/g' | sed -E 's/ +/ /g' | sed 's/^ //;s/ $//')" | shasum -a 256 | head -c 16
```

**注意:** macOSでは `sed` の拡張正規表現に `-E` フラグが必要（`\+` はGNU sed固有）。

正規化ルール:
1. summaryを小文字に変換
2. 数字列を `<NUM>` に置換
3. 連続する空白を1つに圧縮
4. 前後の空白を除去
5. `{category}:{normalized_summary}` のSHA-256の先頭16文字

**停滞検出**（`src/core/loop-runner.ts:224-248` の `isStagnating()` を再現）:

- blocking findingsのfingerprint集合を `previousFingerprintSets` に記録
- 現在のfingerprint集合が直近 `stagnationRounds`（デフォルト2）回連続で同一であれば停滞と判定
- 停滞時はループを終了し、ユーザーに報告

---

#### ステップ3.6: 人間トリアージ

**トリアージが必要な条件**（`src/core/loop-runner.ts:203-222` の `needsHumanGate()` を再現）:

- Round 1 かつ `requireHumanOnFirstRound` が true → **必ずトリアージ**
- または、前ラウンドに存在しなかった新規HIGH severity findingが出現 かつ `requireHumanOnNewHighSeverity` が true → トリアージ

**表示形式:**

Claude Codeが以下の形式でfindingsを表示:

```markdown
## Codexレビュー結果 (Round N)

### Blocking findings（修正が必要）

| # | ID | Severity | Category | Summary |
|---|---|---|---|---|
| 1 | finding-1 | HIGH | correctness | APIエンドポイントのパス不一致 |
| 2 | finding-3 | HIGH | spec_mismatch | エラーハンドリング戦略の不足 |

<details>
<summary>finding-1 の詳細</summary>
{detail}
</details>

<details>
<summary>finding-3 の詳細</summary>
{detail}
</details>

### Non-blocking findings（参考情報）
| # | ID | Severity | Category | Summary |
|---|---|---|---|---|
| 3 | finding-4 | MEDIUM | security | 入力バリデーションの追加を推奨 |

### Auto-waived（自動除外: N件）

---

フィードバックをお願いします。例:
- 「finding-1は対象外」→ 該当指摘を除外
- 「以後、互換性に関する指摘は無視」→ 永続waiver追加
- 「そのまま進めて」→ 全指摘を受け入れて修正へ
```

**フィードバックからのwaiver抽出**（`src/core/triage.ts:169-196` の `extractWaiversFromFeedback()` を再現）:

「以後」「今後」「今回以降」「以降」のキーワードを含む指示を検出し、waiver ruleとして `accumulatedWaivers` に追加:

```typescript
// 概念的なロジック
waiver = {
  match: 「」『』内のテキスト、なければ指示全文,
  action: "ignore",
  reason: 指示全文
}
```

**フィードバック後のCodex再レビュー:**

ユーザーフィードバックがある場合、`codex exec resume <thread_id>` でフィードバック反映プロンプトを送信。調整後のfindingsを受け取る。

---

#### ステップ3.7: 計画ファイルの修正

blocking findingsが1件以上残っている場合、Claude Code自身がEditツール等で `planFile` を直接修正する。

- 各blocking findingの指摘内容に基づいて修正を実施
- 元の要件（`promptFile`）と矛盾しないように注意
- 各findingに対する修正内容をユーザーに報告

---

#### ステップ3.8: ループ継続判定

| 条件 | アクション |
|---|---|
| blocking findings = 0 | 「レビュー完了: blocking findingsが0件になりました」と報告して終了 |
| 停滞検出（同一fingerprint集合が連続） | 「停滞を検出しました。同じ指摘がN回連続しています」と報告して終了 |
| currentRound > maxRounds | 「最大ラウンド数（N回）に達しました」と報告して終了 |
| ユーザーが「止めて」等を指示 | 通常のClaude Code操作として対応 |

blocking findingsが残っている場合は `currentRound++` してステップ3.1（再レビュープロンプト構築）に戻る。

---

### セクション4: エビデンス検証

Round 1のCodex実行後、以下のエビデンス検証を行う（`src/evidence/analyzer.ts` + `src/evidence/verifier.ts` を再現）。

**チェック項目:**

| 条件（plan/prompt内） | 必要なエビデンス | 検証パターン | 分類 |
|---|---|---|---|
| GitHub URL (`github.com/.../issues/...`) or `gh` コマンド参照がある | Codexが `gh issue` / `gh pr` コマンドを実行したか | JSONLの `command_execution` イベントの `command` フィールドに `gh issue` or `gh pr` が含まれるか | required |
| Figma URL (`figma.com/`) がある | Codexが Figma MCP ツールを使用したか | JSONLの `mcp_tool_call` イベントの `tool` フィールドに `figma` が含まれるか | required |
| ドキュメント参照キーワード（「公式ドキュメント」「ドキュメントを参照」等）がある | Codexが Context7 MCP を使用したか | JSONLの `mcp_tool_call` イベントの `tool` フィールドに `context7` or `resolve-library` が含まれるか | suggested |
| Web検索キーワード（「Web検索」「webで確認」等）がある | Codexが Web検索 を使用したか | JSONLの `web_search` イベントが存在するか | suggested |

**検証方法**（`src/evidence/verifier.ts:6-33` の `verifyEvidence()` 相当のツール名レベル照合）:

Codex実行時のJSONL出力（`$PLANLOOP_TMPDIR/codex-jsonl.txt`）からツール使用状況を具体的に抽出する:

```bash
# GitHub CLI の使用確認（command_execution イベントから gh コマンドを抽出）
grep '"command_execution"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | grep -ci '"gh '

# Figma MCP の使用確認（mcp_tool_call イベントから figma ツールを特定）
grep '"mcp_tool_call"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | grep -ci '"figma'

# Context7 MCP の使用確認（mcp_tool_call イベントから context7 / resolve-library を特定）
grep '"mcp_tool_call"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | grep -ci -E '"(context7|resolve-library)'

# Web検索の使用確認
grep -ci '"web_search"' "$PLANLOOP_TMPDIR/codex-jsonl.txt"
```

**required エビデンス未充足時の対応:**

required エビデンスが不足していた場合、**レビュー結果のfindingsを採用せず**、以下のいずれかの対応を取る:

1. **ユーザーに報告し判断を仰ぐ**: 「Codexが必須の情報源（GitHub Issue等）を確認していません。このままレビュー結果を採用しますか？ それとも再実行しますか？」
2. **ユーザーが再実行を選択した場合**: レビュープロンプトに「必ず以下の情報源を確認してからレビューを行ってください」という指示を追加して再実行

suggested エビデンスの不足は参考情報として表示するのみ（ブロッキングにはしない）。

---

### セクション5: エラーハンドリング

| エラー状況 | 対応 |
|---|---|
| planFile / promptFile が存在しない | ファイルが見つからない旨を報告し終了 |
| Codex CLIが未インストール | `npm install -g @openai/codex` でのインストールを案内 |
| Codex CLIがエラー終了 | exit codeとstderr内容を表示、リトライを提案 |
| Codex出力のJSONパース失敗 | 出力ファイルの内容を直接表示し、Claude Code自身がfindingsをテキストから手動で抽出・構造化 |
| `codex exec resume <thread_id>` 失敗 | fresh `codex exec`（`--output-schema` 付き、`--ephemeral` なし）にフォールバック。プロンプト内に前回文脈を含める |
| required エビデンス未充足 | ユーザーに報告し判断を仰ぐ（再実行 or 続行） |
| `.planloop/config.yml` の読み込みエラー | デフォルト設定値にフォールバック |

---

### セクション6: 完了報告

ループ終了時に以下のサマリーを表示:

```markdown
## レビューループ完了

- **ステータス**: {completed | stopped}
- **終了理由**: {no_blocking_findings | stagnation | max_rounds}
- **総ラウンド数**: N
- **適用Waiver**: N件

### ラウンド別サマリー
- Round 1: N件の指摘 → トリアージ → N件blocking → 修正
- Round 2: N件の指摘 → N件blocking → 修正
- Round 3: N件の指摘 → 0件blocking → 完了
```

---

---

## `.claude/skills/codex-review/SKILL.md` の完全なテンプレート

以下が実装時に作成するスキル定義の完全な内容テンプレートである。実装者はこのテンプレートをベースに `.claude/skills/codex-review/SKILL.md` を作成する。

````markdown
---
name: codex-review
description: Codex CLIで実装計画レビューの改善ループを回す
disable-model-invocation: true
---

Codex CLIを使って実装計画をレビューし、指摘→修正の改善ループを回してください。

## 引数

`$ARGUMENTS` を空白で分割し、第1引数をplanFile（レビュー対象の実装計画ファイル）、第2引数をpromptFile（実装計画の元となった要件ファイル）として使用してください。

## 前提条件

- Codex CLIがインストール済み（`codex` コマンドが利用可能）
- レビューループ実行中は別ターミナルでCodexを実行しないでください（セッション引き継ぎに影響するため）

## 実行手順

### 1. 初期セットアップ

1. planFileとpromptFileをReadツールで読み込み、存在を確認してください
2. `.planloop/config.yml` が存在すればReadツールで読み込んでください。存在しなければ以下のデフォルト値を使用:

**デフォルト設定:**
- maxRounds: 8
- stagnationRounds: 2
- blockingCategories: correctness, spec_mismatch, missing_acceptance_criteria, migration_risk
- autoWaiveCategories: speculative_future, unnecessary_fallback
- requireHumanOnFirstRound: true
- requireHumanOnNewHighSeverity: true
- perspectives:
  - correctness: 実装計画の内容が要件と一致しているか
  - spec_mismatch: 仕様との不一致がないか
  - missing_acceptance_criteria: 受け入れ基準の漏れがないか
  - migration_risk: マイグレーションリスクがないか
  - security: セキュリティ上の懸念がないか
  - performance: パフォーマンス上の懸念がないか

3. 以下の状態を管理してください:
   - currentRound（現在のラウンド番号、1から開始）
   - accumulatedWaivers（蓄積されたwaiver rule のリスト）
   - previousBlockingFingerprints（前ラウンドのblocking findingsのfingerprint集合。停滞検出用）

### 2. レビューループ

currentRound が maxRounds 以下の間、以下を繰り返してください。

#### 2.1 Codexレビュープロンプトの構築

planFileとpromptFileの最新内容を読み込み、以下のテンプレートでCodexへのレビュープロンプトを構築してください。

**初回レビュー（Round 1）のプロンプト:**

```
あなたは実装計画のレビュアーです。以下の実装計画をレビューしてください。

## レビュー対象の実装計画

{planFileの内容をそのまま挿入}

## 実装計画の元となった要件（プロンプト）

{promptFileの内容をそのまま挿入}

## レビュー指示

1. 以下の観点でレビューを行ってください:
{config.perspectivesの各項目を箇条書きで挿入}

2. 以下の種類の指摘は避けてください:
   - speculative_future: 「将来必要になるかもしれない」だけの指摘
   - unnecessary_fallback: 不要なフォールバック実装の要求

{config.review.additionalInstructionsが設定されている場合:
3. 追加指示:
{additionalInstructionsの内容}}

{accumulatedWaiversが空でない場合:
## 前回のレビューでの調整事項

以下の観点は前回のレビューで対象外と判断されています。これらに該当する指摘は出力しないでください。

{各waiverについて: - {reason} (カテゴリ: {category ?? "全て"}, パターン: {match})}}

## 出力形式

以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください。

{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明",
      "severity": "high | medium | low",
      "category": "correctness | spec_mismatch | missing_acceptance_criteria | migration_risk | security | performance | code_quality | other",
      "lineRef": null
    }
  ]
}
```

**再レビュー（Round 2+）のプロンプト:**

```
実装計画が修正されました。修正後の計画を改めてレビューしてください。

## 修正後の実装計画

{修正後のplanFileの内容}

## 修正内容の概要

{前ラウンドで修正した内容のサマリー}

## レビュー指示

前回と同じ観点でレビューし、残存する指摘があれば出力してください。
修正により解消された指摘は含めないでください。
新たに気づいた指摘があれば追加してください。

{waiver section（上記と同じ形式）}

## 出力形式（重要: 必ず以下のJSON形式で出力してください）

{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明",
      "severity": "high | medium | low",
      "category": "correctness | spec_mismatch | missing_acceptance_criteria | migration_risk | security | performance | code_quality | other",
      "lineRef": null
    }
  ]
}
```

**フィードバック反映プロンプト（トリアージ後に使用）:**

重要: 元実装 `generateCodexFeedbackReviewPrompt()` と同様に、planFileとpromptFileの内容を必ず含めてください。

```
あなたは実装計画のレビュアーです。前回のレビューに対して人間からフィードバックがあったため、調整後のレビュー結果を出力してください。

## レビュー対象の実装計画

{planFileの内容をそのまま挿入}

## 実装計画の元となった要件（プロンプト）

{promptFileの内容をそのまま挿入}

## 前回のレビュー指摘

{各findingを "### finding-N [SEVERITY] category\nsummary\ndetail" 形式で列挙}

## 人間からのフィードバック

{ユーザーのフィードバックテキスト}

## 指示

上記のフィードバックを踏まえ、以下の条件で再レビューしてください:
1. waiveまたは対象外と指示された指摘は含めないでください
2. フィードバックで修正方針が示された指摘は、その方針を反映して調整してください
3. フィードバックで言及されていない指摘はそのまま残してください
4. 新たに気づいた指摘があれば追加してください

## 出力形式

以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください。

{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明",
      "severity": "high | medium | low",
      "category": "correctness | spec_mismatch | missing_acceptance_criteria | migration_risk | security | performance | code_quality | other",
      "lineRef": null
    }
  ]
}
```

#### 2.2 Codex CLI実行

まず、一時ファイルの衝突を防ぐため、runごとに一意な一時ディレクトリを作成してください:
```bash
PLANLOOP_TMPDIR=$(mktemp -d /tmp/planloop-run-XXXXXX)
```

構築したプロンプトを `$PLANLOOP_TMPDIR/prompt.txt` に書き出し、以下のコマンドで実行してください。

**初回レビュー（Round 1の1回目）:**
```bash
cat "$PLANLOOP_TMPDIR/prompt.txt" | codex exec --json --full-auto --output-schema .claude/skills/codex-review/codex-review-output.json -o "$PLANLOOP_TMPDIR/codex-output.txt" - 2>&1 | tee "$PLANLOOP_TMPDIR/codex-jsonl.txt" > /dev/null
```

実行後、JSONL出力からthread_idを抽出して保持してください:
```bash
grep -o '"thread_id":"[^"]*"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | head -1 | sed 's/"thread_id":"//;s/"//'
```

**フィードバック反映 / 再レビュー（resume、2回目以降）:**
```bash
cat "$PLANLOOP_TMPDIR/prompt.txt" | codex exec resume "<保持したthread_id>" --json --full-auto -o "$PLANLOOP_TMPDIR/codex-output.txt" - 2>&1 | tee "$PLANLOOP_TMPDIR/codex-jsonl.txt" > /dev/null
```

注意:
- `--ephemeral` は使用しない（セッション保持のため）
- 初回は `--output-schema` で構造化出力を強制。2回目以降はresumeのため `--output-schema` 利用不可 → プロンプト内にJSON出力形式を明記
- `codex exec resume` には `--last` ではなく**明示的な `thread_id`** を指定（誤セッション再開リスク回避）
- resume失敗時は fresh `codex exec`（`--output-schema` 付き）にフォールバック

#### 2.3 結果パース

`$PLANLOOP_TMPDIR/codex-output.txt` をReadツールで読み取り、findingsを抽出してください。

パース手順:
1. JSONコードブロック（```json ... ```）があればその中身を抽出
2. なければ `{` から `}` までのJSONオブジェクトを探す
3. `findings` 配列内の各要素の必須フィールド（id, summary, detail, severity, category）を確認
4. パースに失敗した場合は、テキストから手動でfindingsを構造化

#### 2.4 Waiver適用とフィルタリング

1. autoWaiveCategories（speculative_future, unnecessary_fallback）に該当するfindingsを自動除外
2. accumulatedWaiversの各ruleと照合（カテゴリ一致 + summary/detailにmatchテキストが含まれるか）
3. blockingCategories（correctness, spec_mismatch, missing_acceptance_criteria, migration_risk）に該当するfindingsのみblocking扱い

分類結果:
- blocking: 修正が必要な指摘
- non-blocking: 参考情報（表示のみ）
- waived: 除外済み（件数のみ報告）

#### 2.5 停滞検出

各blocking findingのフィンガープリントを算出してください。

算出方法（Bashで実行）:
```bash
printf '%s' "{category}:{normalized_summary}" | shasum -a 256 | head -c 16
```
ここで normalized_summary は:
- summaryを小文字に変換
- 数字列を `<NUM>` に置換（sed -E 's/[0-9]+/<NUM>/g'）
- 連続する空白を1つに圧縮
- 前後の空白を除去

blocking findingsのfingerprint集合が、直近 stagnationRounds 回（デフォルト2）連続で同一であれば「停滞」と判定してループを終了してください。

#### 2.6 人間トリアージ

以下の条件でトリアージを求めてください:
- Round 1 かつ requireHumanOnFirstRound が true → 必ずトリアージ
- 前ラウンドに存在しなかった新規HIGH findingが出現 かつ requireHumanOnNewHighSeverity が true → トリアージ

トリアージ時は以下の形式でfindingsを表示し、フィードバックを求めてください:

```
## Codexレビュー結果 (Round N)

### Blocking findings（修正が必要）
| # | ID | Severity | Category | Summary |
|---|---|---|---|---|
| 1 | finding-1 | HIGH | correctness | ... |

（各findingの詳細も表示）

### Non-blocking findings（参考情報）
（該当があれば表示）

### Auto-waived（自動除外: N件）

---
フィードバックをお願いします。例:
- 「finding-1は対象外」
- 「以後、互換性に関する指摘は無視」
- 「そのまま進めて」
```

フィードバックに「以後」「今後」「今回以降」「以降」のキーワードが含まれる場合、waiver ruleとしてaccumulatedWaiversに追加してください:
- match: 「」『』内のテキスト（なければ指示全文）
- action: "ignore"
- reason: 指示全文

フィードバックがある場合は「フィードバック反映プロンプト」でCodexセッションを再開し、調整後のfindingsを受け取ってください。

#### 2.7 計画ファイルの修正

blocking findingsが1件以上ある場合、Editツール等を使ってplanFileを直接修正してください。

- 各blocking findingの指摘内容に基づいて修正
- promptFileの要件と矛盾しないように注意
- 修正した内容を報告

#### 2.8 ループ継続判定

| 条件 | アクション |
|---|---|
| blocking findings = 0 | 完了と報告して終了 |
| 停滞検出 | 停滞を報告して終了 |
| currentRound > maxRounds | 最大ラウンド数到達と報告して終了 |

blocking findingsが残っている場合は currentRound をインクリメントしてステップ2.1に戻ってください。

### 3. エビデンス検証（Round 1完了後）

Codex実行時のJSONL出力（`$PLANLOOP_TMPDIR/codex-jsonl.txt`）から、ツール使用状況をツール名レベルで検証してください。

**検証コマンド（Bashで実行）:**
```bash
# GitHub CLI: command_execution イベントから gh コマンドを特定
grep '"command_execution"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | grep -ci '"gh '
# Figma MCP: mcp_tool_call イベントから figma ツールを特定
grep '"mcp_tool_call"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | grep -ci '"figma'
# Context7 MCP: mcp_tool_call イベントから context7/resolve-library を特定
grep '"mcp_tool_call"' "$PLANLOOP_TMPDIR/codex-jsonl.txt" | grep -ci -E '"(context7|resolve-library)'
# Web検索
grep -ci '"web_search"' "$PLANLOOP_TMPDIR/codex-jsonl.txt"
```

**チェックルール:**
- planFile/promptFile内にGitHub URLがある → `gh` コマンド使用が **required**
- Figma URLがある → Figma MCP使用が **required**
- ドキュメント参照キーワードがある → Context7 MCP使用が **suggested**
- Web検索キーワードがある → Web検索使用が **suggested**

**required エビデンス未充足時:**
レビュー結果を採用せず、ユーザーに「必須の情報源を確認していません。再実行しますか？」と確認してください。再実行時はプロンプトに「必ず以下の情報源を確認してからレビューを行ってください」と追加。
suggested の不足は参考情報として報告するのみ。

### 4. 完了報告

ループ終了時に以下のサマリーを表示してください:

```
## レビューループ完了

- ステータス: {completed | stopped}
- 終了理由: {no_blocking_findings | stagnation | max_rounds}
- 総ラウンド数: N
- 適用Waiver: N件

### ラウンド別サマリー
- Round 1: N件 → トリアージ → N件blocking → 修正
- Round 2: N件 → N件blocking → 修正
- Round 3: N件 → 0件blocking → 完了
```

## エラーハンドリング

| エラー | 対応 |
|---|---|
| planFile/promptFileが見つからない | 報告して終了 |
| Codex CLI未インストール | `npm install -g @openai/codex` を案内 |
| Codexエラー終了 | エラー内容を表示、リトライを提案 |
| JSONパース失敗 | テキストから手動で構造化 |
| resume失敗（thread_idでのセッション再開失敗） | fresh `codex exec`（`--output-schema` 付き）にフォールバック |
| requiredエビデンス未充足 | ユーザーに報告し再実行 or 続行を確認 |
| 設定ファイルエラー | デフォルト値にフォールバック |
````

---

## #3から流用するロジックの対応表

| #3のコンポーネント | ファイル | 流用方法 |
|---|---|---|
| `OUTPUT_SCHEMA` | `src/adapters/codex-cli.ts:39-86` | `.claude/skills/codex-review/codex-review-output.json` として静的ファイル化 |
| `generateCodexReviewPrompt()` | `src/prompts/codex-review.ts:7-59` | スキル定義内のプロンプトテンプレートとしてインライン化 |
| `generateCodexFeedbackReviewPrompt()` | `src/prompts/codex-review.ts:62-118` | スキル定義内のフィードバック反映プロンプトとしてインライン化 |
| `buildWaiverSection()` | `src/prompts/codex-review.ts:120-139` | プロンプト構築手順内に組み込み |
| `parseFindings()` / `extractJson()` | `src/adapters/codex-cli.ts:272-340` | Claude Code自身のJSON理解力で代替 + パース手順を指示 |
| `parseFindingsFromJsonl()` | `src/adapters/codex-cli.ts:302-323` | resume時のフォールバックパース手順として指示 |
| `generateFingerprint()` | `src/core/fingerprint.ts:4-15` | Bashの `shasum -a 256` コマンドで代替 |
| `applyWaivers()` / `matchesWaiver()` | `src/core/waiver.ts:9-50` | スキル定義内の手順としてロジックを記述 |
| `needsHumanGate()` | `src/core/loop-runner.ts:203-222` | トリアージ条件としてスキル定義に記述 |
| `isStagnating()` | `src/core/loop-runner.ts:224-248` | 停滞検出ロジックとしてスキル定義に記述 |
| `filterByBlockingCategories()` | `src/core/loop-runner.ts:262-269` | blocking分類手順として記述 |
| `analyzeEvidenceRequirements()` | `src/evidence/analyzer.ts:18-76` | エビデンス検証手順として記述 |
| `verifyEvidence()` | `src/evidence/verifier.ts:6-33` | エビデンス検証手順として記述 |
| `extractWaiversFromFeedback()` | `src/core/triage.ts:169-196` | フィードバック解析手順として記述 |
| Config defaults | `src/config/schema.ts` | デフォルト値をスラッシュコマンド内に記述 |

## #3から不要になるもの

| コンポーネント | 理由 |
|---|---|
| `createClaudeCliAdapter()` (`src/adapters/claude-cli.ts`) | Claude Code自身がEditツールで修正するため不要 |
| `runNaturalLanguageTriage()` (`src/core/triage.ts`) | 会話ベースのトリアージに置き換え |
| `runLoop()` (`src/core/loop-runner.ts`) | スキルのプロンプトでループ制御 |
| `handler.ts` (`src/intervention/handler.ts`) | 通常のClaude Code操作で代替 |
| `displayResult()` (`src/display/result.ts`) | 会話内で自然に報告 |
| `stream-renderer.ts` (`src/display/stream-renderer.ts`) | Claude Code自身のUIで表示 |

---

## 検証手順

### 前提
- Codex CLIがインストール済みであること
- `.planloop/config.yml` が存在すること（`planloop init` で生成可能）

### 手順

1. **JSONスキーマの検証**:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('.claude/skills/codex-review/codex-review-output.json', 'utf8')); console.log('OK')"
   ```

2. **スキルの認識確認**:
   Claude Codeで `/codex-review` と入力し、コマンドが認識されることを確認

3. **E2Eテスト**:
   テスト用のplanファイルとpromptファイルを用意し、`/codex-review <plan> <prompt>` を実行:
   - Codexが正常に呼び出されること
   - findingsがJSON形式でパースされること
   - ユーザーにfindingsが表示されること
   - フィードバック（例: 「finding-1は対象外」）が反映されること
   - 計画ファイルがClaude Codeによって修正されること
   - `codex exec resume <thread_id>` で再レビューが実行されること
   - blocking findingsが0件になったらループが終了すること

4. **品質管理**（既存TypeScriptコードへの影響がないことを確認）:
   ```bash
   npm run format
   npm run lint
   npm run test
   npm run build
   ```
