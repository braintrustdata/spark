import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { DetectedLanguage } from "./language-detect";

type TelemetryChild = {
  write: (update: Record<string, string>) => void;
  finish: () => void;
  setPiRunning: (running: boolean) => void;
  markSigint: () => void;
};

let child: TelemetryChild | null = null;

function telemetryBin(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  return join(dir, "crank-telemetry.mjs");
}

export function startTelemetry(env: NodeJS.ProcessEnv): void {
  const flag = env["CRANK_ENABLE_TELEMETRY"];
  if (flag !== undefined && flag.toUpperCase() === "FALSE") return;

  const spawnEnv: NodeJS.ProcessEnv = { ...env };
  if (env["CRANK_TELEMETRY_URL"]) {
    spawnEnv["CRANK_TELEMETRY_URL"] = env["CRANK_TELEMETRY_URL"];
  }

  const proc = spawn(process.execPath, [telemetryBin()], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: spawnEnv,
  });
  proc.unref();

  let finished = false;
  let sigintReceived = false;
  let piRunning = false;

  process.on("SIGINT", () => {
    if (piRunning) return;
    sigintReceived = true;
    child?.finish();
    process.exit(1);
  });

  child = {
    write(update) {
      if (finished) return;
      try {
        proc.stdin?.write(JSON.stringify(update) + "\n");
      } catch {
        // ignore write errors
      }
    },
    finish() {
      if (finished) return;
      finished = true;
      if (sigintReceived) {
        proc.stdin?.end();
      } else {
        proc.stdin?.end(JSON.stringify({ stopReason: "finished" }) + "\n");
      }
    },
    setPiRunning(running: boolean) {
      piRunning = running;
    },
    markSigint() {
      sigintReceived = true;
    },
  };
}

export function setTelemetryLanguage(
  language: DetectedLanguage | "unknown",
): void {
  child?.write({ language });
}

export function setTelemetryProvider(provider: string): void {
  child?.write({ provider });
}

export function finishTelemetry(): void {
  child?.finish();
}

export function notifyPiRunning(running: boolean): void {
  child?.setPiRunning(running);
}

export function markTelemetrySigint(): void {
  child?.markSigint();
}
