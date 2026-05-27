import { spawn } from "node:child_process";
import type { Buffer } from "node:buffer";
import { platform } from "node:os";

import type {
  Adapter,
  CaptureResult,
  CodingToolEvent,
  CodingToolRunResult,
  CommandSpec,
} from "./types";
import { firstNonEmptyLine } from "./utils";

export async function findCommand(
  command: string,
): Promise<string | undefined> {
  if (platform() === "win32") {
    const result = await execCapture("where", [command]);
    const first = result.stdout.split(/\r?\n/).find(Boolean);
    return result.exitCode === 0 ? first : undefined;
  }
  const result = await execCapture("sh", [
    "-c",
    `command -v ${shellQuote(command)}`,
  ]);
  const first = result.stdout.trim().split(/\r?\n/)[0];
  return result.exitCode === 0 && first ? first : undefined;
}

export async function versionOf(
  commandPath: string,
): Promise<string | undefined> {
  const result = await execCapture(commandPath, ["--version"]);
  if (result.exitCode !== 0) return undefined;
  return firstNonEmptyLine(result.stdout);
}

export function execCapture(
  command: string,
  args: readonly string[],
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on("data", (chunk: Buffer) =>
      stdout.push(chunk.toString("utf8")),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      stderr.push(chunk.toString("utf8")),
    );
    child.on("error", (error) =>
      resolve({
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: error.message,
      }),
    );
    child.on("close", (code, signal) =>
      resolve({
        exitCode: code ?? 1,
        signal,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      }),
    );
  });
}

export function runToolCommand(
  adapter: Adapter,
  spec: CommandSpec,
  onEvent?: (event: CodingToolEvent) => void,
): Promise<CodingToolRunResult> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutLines = new JsonLineBuffer((value) => {
      for (const event of adapter.parseEvents(value, spec.cwd)) {
        onEvent?.(event);
      }
      const finalText = adapter.parseFinalText(value);
      if (finalText) finalParts.push(finalText);
    });
    const stderr: string[] = [];
    const finalParts: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLines.push(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      onEvent?.({ type: "failed", message: error.message });
      resolve({
        exitCode: 1,
        signal: null,
        finalText: `${finalParts.join("\n")}\n${error.message}`.trim(),
      });
    });
    child.on("close", (code, signal) => {
      stdoutLines.flush();
      const exitCode = code ?? 1;
      onEvent?.({
        type: exitCode === 0 ? "completed" : "failed",
        message:
          exitCode === 0
            ? `${adapter.label} completed.`
            : `${adapter.label} exited with code ${exitCode}.`,
      });
      resolve({
        exitCode,
        signal,
        finalText: `${finalParts.join("\n")}\n${stderr.join("").trim()}`.trim(),
      });
    });
    child.stdin.end(spec.stdin);
  });
}

class JsonLineBuffer {
  private buffer = "";

  constructor(private readonly onValue: (value: unknown) => void) {}

  push(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      this.consume(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  flush() {
    this.consume(this.buffer.trim());
    this.buffer = "";
  }

  private consume(line: string) {
    if (!line) return;
    try {
      this.onValue(JSON.parse(line));
    } catch {
      // Coding tools can emit incidental non-JSON diagnostics. Those are not
      // useful for progress rendering and can contain noisy local details.
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
