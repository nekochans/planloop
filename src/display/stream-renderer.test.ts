import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { renderStream } from "./stream-renderer.js";

const createMockChildProcess = (outputChunks: string[]): ChildProcess => {
  const mockStdout = new EventEmitter();
  const mockProcess = new EventEmitter() as ChildProcess;
  (mockProcess as { stdout: EventEmitter }).stdout = mockStdout;

  setTimeout(() => {
    for (const chunk of outputChunks) {
      mockStdout.emit("data", Buffer.from(chunk));
    }
    mockStdout.emit("end");
    mockProcess.emit("close", 0);
  }, 10);

  return mockProcess;
};

describe("renderStream", () => {
  it("should collect all output from codex-jsonl format", async () => {
    const lines = [
      '{"type": "message", "role": "assistant", "content": "Starting review"}\n',
      '{"type": "command_execution", "command": "gh issue view 3"}\n',
    ];
    const child = createMockChildProcess(lines);
    const output = await renderStream(child, "Codex レビュー", "codex-jsonl");
    expect(output).toContain("command_execution");
    expect(output).toContain("message");
  });

  it("should handle empty stream", async () => {
    const child = createMockChildProcess([]);
    const output = await renderStream(child, "Test", "codex-jsonl");
    expect(output).toBe("");
  });

  it("should skip invalid JSON lines without error", async () => {
    const lines = ["not json\n", '{"type": "message", "content": "valid"}\n'];
    const child = createMockChildProcess(lines);
    const output = await renderStream(child, "Test", "codex-jsonl");
    expect(output).toContain("not json");
    expect(output).toContain("valid");
  });

  it("should collect claude stream-json output", async () => {
    const lines = [
      '{"type": "tool_use", "tool": "Read", "path": "plan.md"}\n',
      '{"type": "result", "result": "done"}\n',
    ];
    const child = createMockChildProcess(lines);
    const output = await renderStream(
      child,
      "Claude Code 修正",
      "claude-stream-json"
    );
    expect(output).toContain("tool_use");
    expect(output).toContain("result");
  });
});
