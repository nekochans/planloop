#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { stringify as stringifyYaml } from "yaml";
import { createClaudeCliAdapter } from "../adapters/claude-cli.js";
import { createCodexCliAdapter } from "../adapters/codex-cli.js";
import { loadConfig } from "../config/loader.js";
import { runLoop } from "../core/loop-runner.js";
import { displayResult } from "../display/result.js";
import type { LoopState } from "../types/index.js";

const program = new Command();

program
  .name("planloop")
  .description(
    "AIコーディングエージェントが作成した実装計画のレビューループを自動化するCLIツール"
  )
  .version("0.1.0");

program
  .command("run")
  .description("レビューループを実行する")
  .requiredOption("--plan <file>", "レビュー対象の実装計画ファイル")
  .requiredOption("--prompt <file>", "実装計画の元となったプロンプトファイル")
  .action(async (options) => {
    try {
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
    } catch (err) {
      console.error(
        `\nエラー: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }
  });

program
  .command("status")
  .description("ループの状態を表示する")
  .option("--run <run-id>", "表示するランのID（省略時は最新）")
  .action(async (options) => {
    const config = await loadConfig(process.cwd());
    const runDir = config.paths.runDir;

    let targetRunId: string;
    if (options.run) {
      targetRunId = options.run;
    } else {
      const entries = await readdir(runDir).catch(() => []);
      if (entries.length === 0) {
        console.error("実行履歴がありません。");
        process.exit(1);
      }
      targetRunId = entries.sort().at(-1) as string;
    }

    const statePath = resolve(runDir, targetRunId, "state.json");
    try {
      const stateJson = await readFile(statePath, "utf-8");
      const state: LoopState = JSON.parse(stateJson);
      displayResult(state, process.stdout);
    } catch {
      console.error(`状態ファイルが見つかりません: ${statePath}`);
      process.exit(1);
    }
  });

program
  .command("init")
  .description("デフォルト設定ファイルと.gitignoreエントリを生成する")
  .action(async () => {
    const planloopDir = resolve(process.cwd(), ".planloop");
    const configPath = resolve(planloopDir, "config.yml");
    const runsDir = resolve(planloopDir, "runs");

    await mkdir(planloopDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });

    try {
      await readFile(configPath, "utf-8");
      console.log(".planloop/config.yml は既に存在します。");
    } catch {
      const defaultConfig = {
        version: 1,
        paths: {
          reviewDir: "design-docs-for-ai",
          runDir: ".planloop/runs",
        },
        policy: {
          requireHumanOnFirstRound: true,
          requireHumanOnNewHighSeverity: true,
          maxRounds: 8,
          stagnationRounds: 2,
          blockingCategories: [
            "correctness",
            "spec_mismatch",
            "missing_acceptance_criteria",
            "migration_risk",
          ],
          autoWaiveCategories: ["speculative_future", "unnecessary_fallback"],
        },
        review: {
          perspectives: [
            "correctness: 実装計画の内容が要件と一致しているか",
            "spec_mismatch: 仕様との不一致がないか",
            "missing_acceptance_criteria: 受け入れ基準の漏れがないか",
            "migration_risk: マイグレーションリスクがないか",
            "security: セキュリティ上の懸念がないか",
            "performance: パフォーマンス上の懸念がないか",
          ],
        },
        engines: {
          claude: {
            mode: "inherited",
          },
        },
      };
      await writeFile(configPath, stringifyYaml(defaultConfig), "utf-8");
      console.log(".planloop/config.yml を生成しました。");
    }

    const gitignorePath = resolve(process.cwd(), ".gitignore");
    const entry = ".planloop/runs/";
    try {
      const content = await readFile(gitignorePath, "utf-8");
      if (!content.includes(entry)) {
        await writeFile(
          gitignorePath,
          `${content.trimEnd()}\n${entry}\n`,
          "utf-8"
        );
        console.log(`.gitignore に ${entry} を追加しました。`);
      }
    } catch {
      await writeFile(gitignorePath, `${entry}\n`, "utf-8");
      console.log(`.gitignore を生成し、${entry} を追加しました。`);
    }
  });

program.parse();
