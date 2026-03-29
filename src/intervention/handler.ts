export type InterventionAction = "abort" | "retry" | "continue";

export type StopMonitor = () => void;

export const startInterventionMonitor = (
  onIntervene: () => Promise<InterventionAction>
): StopMonitor => {
  if (!process.stdin.isTTY) {
    // no-op for non-TTY environments
    return () => undefined;
  }

  let active = true;

  const onData = async (data: Buffer) => {
    if (!active) {
      return;
    }
    const key = data.toString();
    if (key === "q" || key === "Q") {
      active = false;
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      await onIntervene();
    }
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);

  return () => {
    active = false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeListener("data", onData);
    process.stdin.pause();
  };
};

export const promptInterventionAction = (
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream
): Promise<InterventionAction> => {
  const message = `
\u26a0 介入を検出しました。実行中のプロセスを停止しました。

  [A] 中断して終了   \u2014 このラウンドの結果を破棄し、ここまでの状態を保存して終了
  [R] やり直し       \u2014 このラウンドを最初からやり直す
  [C] 続行           \u2014 中断を取り消して処理を続行（プロセスは再開されます）
> `;
  stdout.write(message);

  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      const key = data.toString().trim().toUpperCase();
      stdin.removeListener("data", onData);
      if (key === "A") {
        resolve("abort");
      } else if (key === "R") {
        resolve("retry");
      } else {
        resolve("continue");
      }
    };
    stdin.on("data", onData);
  });
};
