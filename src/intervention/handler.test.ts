import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { promptInterventionAction } from "./handler.js";

describe("promptInterventionAction", () => {
  it("should return abort for A key", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = promptInterventionAction(stdin, stdout);
    stdin.write("A");
    const result = await promise;
    expect(result).toBe("abort");
  });

  it("should return retry for R key", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = promptInterventionAction(stdin, stdout);
    stdin.write("R");
    const result = await promise;
    expect(result).toBe("retry");
  });

  it("should return continue for C key", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = promptInterventionAction(stdin, stdout);
    stdin.write("C");
    const result = await promise;
    expect(result).toBe("continue");
  });

  it("should return continue for unknown key", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = promptInterventionAction(stdin, stdout);
    stdin.write("X");
    const result = await promise;
    expect(result).toBe("continue");
  });

  it("should display intervention message", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const promise = promptInterventionAction(stdin, stdout);
    stdin.write("A");
    await promise;
    expect(output).toContain("介入を検出しました");
    expect(output).toContain("[A]");
    expect(output).toContain("[R]");
    expect(output).toContain("[C]");
  });
});
