import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PlanloopConfig } from "../types/index.js";
import { configSchema } from "./schema.js";

export const loadConfig = async (basePath: string): Promise<PlanloopConfig> => {
  const ymlPath = resolve(basePath, ".planloop", "config.yml");
  const yamlPath = resolve(basePath, ".planloop", "config.yaml");

  let rawContent: string | undefined;

  for (const configPath of [ymlPath, yamlPath]) {
    try {
      rawContent = await readFile(configPath, "utf-8");
      break;
    } catch {
      // file not found, try next
    }
  }

  if (rawContent === undefined) {
    return configSchema.parse({ version: 1 });
  }

  const parsed = parseYaml(rawContent);
  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`設定ファイルのバリデーションエラー:\n${messages}`);
  }

  return result.data;
};
