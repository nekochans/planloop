import type { ChildProcess } from "node:child_process";

export const renderStream = (
  childProcess: ChildProcess,
  label: string,
  format: "codex-jsonl" | "claude-stream-json"
): Promise<string> => {
  return new Promise((resolve) => {
    let output = "";

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;

      if (format === "codex-jsonl") {
        renderCodexJsonl(text, label);
      } else {
        renderClaudeStreamJson(text, label);
      }
    });

    childProcess.on("close", () => {
      resolve(output);
    });
  });
};

const renderCodexJsonl = (text: string, _label: string): void => {
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (event.type === "command_execution") {
        process.stderr.write(`  [tool] ${event.command}\n`);
      } else if (event.type === "mcp_tool_call") {
        process.stderr.write(`  [tool] ${event.tool}\n`);
      } else if (event.type === "web_search") {
        process.stderr.write(`  [search] ${event.query}\n`);
      }
    } catch {
      // skip non-JSON lines
    }
  }
};

const renderClaudeStreamJson = (text: string, _label: string): void => {
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (event.type === "tool_use") {
        const toolName = event.tool || event.name || "unknown";
        process.stderr.write(`  [${toolName}] ${event.path || ""}\n`);
      }
    } catch {
      // skip non-JSON lines
    }
  }
};
