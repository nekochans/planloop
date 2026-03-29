import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "../../dist/bin/planloop.js");

const exec = (args: string[], cwd?: string) =>
  execFileSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    cwd,
    timeout: 10_000,
  });

describe("planloop CLI", () => {
  it("should display version", () => {
    const result = exec(["--version"]);
    expect(result.trim()).toBe("0.1.0");
  });

  it("should display help", () => {
    const result = exec(["--help"]);
    expect(result).toContain("planloop");
    expect(result).toContain("run");
    expect(result).toContain("status");
    expect(result).toContain("init");
  });

  it("should display run command help", () => {
    const result = exec(["run", "--help"]);
    expect(result).toContain("--plan");
    expect(result).toContain("--prompt");
  });

  it("should error when run is called without --plan", () => {
    expect(() => exec(["run", "--prompt", "test.md"])).toThrow();
  });

  it("should error when run is called without --prompt", () => {
    expect(() => exec(["run", "--plan", "test.md"])).toThrow();
  });

  describe("init command", () => {
    let testDir: string;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), "planloop-init-test-"));
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("should generate default config file", () => {
      const result = exec(["init"], testDir);
      expect(result).toContain("config.yml");

      const configContent = readFileSync(
        join(testDir, ".planloop", "config.yml"),
        "utf-8"
      );
      expect(configContent).toContain("version: 1");
      expect(configContent).toContain("maxRounds: 8");
    });

    it("should not overwrite existing config", () => {
      const result = exec(["init"], testDir);
      expect(result).toContain("既に存在します");
    });
  });
});
