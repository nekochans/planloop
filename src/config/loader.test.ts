import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./loader.js";

describe("loadConfig", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `planloop-test-${Date.now()}`);
    await mkdir(join(testDir, ".planloop"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should load a valid config file (.yml)", async () => {
    await writeFile(
      join(testDir, ".planloop", "config.yml"),
      "version: 1\npolicy:\n  maxRounds: 5\n"
    );
    const config = await loadConfig(testDir);
    expect(config.version).toBe(1);
    expect(config.policy.maxRounds).toBe(5);
  });

  it("should load a valid config file (.yaml)", async () => {
    await writeFile(
      join(testDir, ".planloop", "config.yaml"),
      "version: 1\npolicy:\n  maxRounds: 3\n"
    );
    const config = await loadConfig(testDir);
    expect(config.policy.maxRounds).toBe(3);
  });

  it("should prefer .yml over .yaml", async () => {
    await writeFile(
      join(testDir, ".planloop", "config.yml"),
      "version: 1\npolicy:\n  maxRounds: 10\n"
    );
    await writeFile(
      join(testDir, ".planloop", "config.yaml"),
      "version: 1\npolicy:\n  maxRounds: 3\n"
    );
    const config = await loadConfig(testDir);
    expect(config.policy.maxRounds).toBe(10);
  });

  it("should return defaults when no config file exists", async () => {
    await rm(join(testDir, ".planloop"), { recursive: true, force: true });
    const config = await loadConfig(testDir);
    expect(config.version).toBe(1);
    expect(config.policy.maxRounds).toBe(8);
    expect(config.policy.requireHumanOnFirstRound).toBe(true);
    expect(config.paths.reviewDir).toBe("design-docs-for-ai");
    expect(config.paths.runDir).toBe(".planloop/runs");
  });

  it("should apply defaults for missing fields in partial config", async () => {
    await writeFile(join(testDir, ".planloop", "config.yml"), "version: 1\n");
    const config = await loadConfig(testDir);
    expect(config.policy.maxRounds).toBe(8);
    expect(config.policy.stagnationRounds).toBe(2);
    expect(config.engines.claude.mode).toBe("inherited");
  });

  it("should throw on invalid YAML syntax", async () => {
    await writeFile(
      join(testDir, ".planloop", "config.yml"),
      "version: 1\npolicy:\n  maxRounds: [invalid"
    );
    await expect(loadConfig(testDir)).rejects.toThrow();
  });

  it("should throw on invalid version", async () => {
    await writeFile(join(testDir, ".planloop", "config.yml"), "version: 2\n");
    await expect(loadConfig(testDir)).rejects.toThrow("バリデーションエラー");
  });

  it("should throw on out-of-range maxRounds", async () => {
    await writeFile(
      join(testDir, ".planloop", "config.yml"),
      "version: 1\npolicy:\n  maxRounds: 100\n"
    );
    await expect(loadConfig(testDir)).rejects.toThrow("バリデーションエラー");
  });

  it("should load custom review perspectives", async () => {
    await writeFile(
      join(testDir, ".planloop", "config.yml"),
      `version: 1\nreview:\n  perspectives:\n    - "custom: カスタム観点"\n`
    );
    const config = await loadConfig(testDir);
    expect(config.review.perspectives).toEqual(["custom: カスタム観点"]);
  });

  it("should load additionalInstructions when set", async () => {
    await writeFile(
      join(testDir, ".planloop", "config.yml"),
      `version: 1\nreview:\n  additionalInstructions: "追加指示"\n`
    );
    const config = await loadConfig(testDir);
    expect(config.review.additionalInstructions).toBe("追加指示");
  });

  it("should have undefined additionalInstructions when not set", async () => {
    await writeFile(join(testDir, ".planloop", "config.yml"), "version: 1\n");
    const config = await loadConfig(testDir);
    expect(config.review.additionalInstructions).toBeUndefined();
  });

  it("should apply default review perspectives when review is not set", async () => {
    await writeFile(join(testDir, ".planloop", "config.yml"), "version: 1\n");
    const config = await loadConfig(testDir);
    expect(config.review.perspectives).toHaveLength(6);
    expect(config.review.perspectives[0]).toContain("correctness");
  });
});
