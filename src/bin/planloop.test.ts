import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("planloop CLI", () => {
  it("should output version info", () => {
    const result = execFileSync(
      "node",
      [resolve(__dirname, "../../dist/bin/planloop.js")],
      { encoding: "utf-8" }
    );
    expect(result.trim()).toBe("planloop v0.1.0");
  });
});
