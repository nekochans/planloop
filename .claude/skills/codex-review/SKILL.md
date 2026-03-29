---
name: codex-review
description: Codex CLIで実装計画レビューの改善ループを回す
disable-model-invocation: true
---

Codex CLIを使って実装計画をレビューし、指摘→修正の改善ループを回してください。

## 対象ファイルの取得

以下の手順でplanFile（レビュー対象の実装計画ファイル）とpromptFile（実装計画の元となった要件ファイル）を取得してください:

1. `$ARGUMENTS` にファイルパスが指定されている場合は、空白で分割し第1引数をplanFile、第2引数をpromptFileとして使用してください
2. `$ARGUMENTS` が空、または不足している場合は、ユーザーに対話的に確認してください:
   - 「レビュー対象の実装計画ファイルのパスを教えてください」
   - 「実装計画の元となった要件ファイルのパスを教えてください」

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

1. JSONコードブロック（三連バッククォートの json ブロック）があればその中身を抽出
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

トリアージ時は以下の形式でfindingsを表示し、フィードバックを求めてください。
ユーザーが判断しやすいよう、各findingの詳細を省略せず表示することが重要です。

```
## Codexレビュー結果 (Round N)

### Blocking findings（修正が必要: N件）

#### finding-1 [HIGH] spec_mismatch
**指摘:** {summary}
**詳細:** {detail}
**計画の該当箇所:** {lineRefがあれば表示、なければ「該当箇所の引用」を計画から抜粋}
**要件との対比:** {計画に書かれている内容} → {要件で求められている内容}

（上記の形式で全てのblocking findingsを列挙）

### Non-blocking findings（参考情報: N件）

#### finding-N [SEVERITY] category
**指摘:** {summary}
**詳細:** {detail}

（上記の形式で全てのnon-blocking findingsを列挙）

### Auto-waived（自動除外: N件）

---
フィードバックをお願いします。例:
- 「finding-1は対象外としてください」→ 該当指摘を除外
- 「以後、互換性に関する指摘は除外でお願いします」→ 永続waiver追加
- 「全て修正をお願いします」→ 全指摘を受け入れて修正へ
```

**表示のポイント:**

- blocking findingsでは「計画に書かれている内容」と「要件で求められている内容」を対比して示し、何がどう間違っているかを一目で分かるようにしてください
- 長い詳細文もそのまま表示してください（折りたたまない）
- non-blocking findingsも同様に詳細を省略せず表示してください

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

| 条件                     | アクション                       |
| ------------------------ | -------------------------------- |
| blocking findings = 0    | 完了と報告して終了               |
| 停滞検出                 | 停滞を報告して終了               |
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

| エラー                                        | 対応                                                         |
| --------------------------------------------- | ------------------------------------------------------------ |
| planFile/promptFileが見つからない             | 報告して終了                                                 |
| Codex CLI未インストール                       | `npm install -g @openai/codex` を案内                        |
| Codexエラー終了                               | エラー内容を表示、リトライを提案                             |
| JSONパース失敗                                | テキストから手動で構造化                                     |
| resume失敗（thread_idでのセッション再開失敗） | fresh `codex exec`（`--output-schema` 付き）にフォールバック |
| requiredエビデンス未充足                      | ユーザーに報告し再実行 or 続行を確認                         |
| 設定ファイルエラー                            | デフォルト値にフォールバック                                 |
