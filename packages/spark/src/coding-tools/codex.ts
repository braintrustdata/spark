import { execCapture, versionOf } from "./process";
import type {
  Adapter,
  CaptureResult,
  CodingToolEvent,
  CodingToolStatus,
} from "./types";
import {
  compactSingleLine,
  firstNonEmptyLine,
  formatToolInput,
  objectValue,
  readablePath,
  stringField,
} from "./utils";

export const codexAdapter: Adapter = {
  id: "codex",
  label: "Codex",
  command: "codex",
  status: codexStatus,
  smokeCommand: ({ commandPath, cwd, prompt }) => ({
    command: commandPath,
    args: [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "-C",
      cwd,
      "-",
    ],
    stdin: prompt,
    cwd,
  }),
  runCommand: ({ commandPath, cwd, prompt, env }) => ({
    command: commandPath,
    args: [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "-s",
      "danger-full-access",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      cwd,
      "-",
    ],
    stdin: prompt,
    cwd,
    env,
  }),
  parseEvents: parseCodexEvents,
  parseFinalText: parseCodexFinalText,
};

async function codexStatus(commandPath: string): Promise<CodingToolStatus> {
  const [version, auth] = await Promise.all([
    versionOf(commandPath),
    execCapture(commandPath, ["login", "status"]),
  ]);
  return codexStatusFromResult(commandPath, version, auth);
}

export function codexStatusFromResult(
  commandPath: string,
  version: string | undefined,
  auth: Pick<CaptureResult, "exitCode" | "stdout" | "stderr">,
): CodingToolStatus {
  const base = {
    id: "codex" as const,
    label: "Codex",
    command: commandPath,
    installed: true,
    version,
  };
  const loginLine = [
    ...auth.stdout.split(/\r?\n/),
    ...auth.stderr.split(/\r?\n/),
  ]
    .map((line) => line.trim())
    .find((line) => /^Logged in(?:\s+using)?\b/.test(line));
  if (!loginLine) {
    return {
      ...base,
      usable: false,
      unavailableReason:
        firstNonEmptyLine(auth.stderr, auth.stdout) ??
        "Codex is not logged in.",
    };
  }
  return {
    ...base,
    usable: true,
    authMode:
      loginLine
        .replace(/^Logged in using\s+/, "")
        .replace(/^Logged in\s*/, "")
        .trim() || undefined,
  };
}

export function parseCodexEvent(
  value: unknown,
  cwd: string,
): CodingToolEvent | undefined {
  return parseCodexEvents(value, cwd)[0];
}

export function parseCodexEvents(
  value: unknown,
  cwd: string,
): readonly CodingToolEvent[] {
  const obj = objectValue(value);
  const type = stringField(obj, "type");
  if (type === "thread.started" || type === "turn.started") {
    return [{ type: "thinking", message: "Thinking..." }];
  }
  if (type === "turn.completed") {
    return [{ type: "completed", message: "Tool run completed." }];
  }
  if (type === "error") {
    return [{ type: "failed", message: "Tool run failed." }];
  }
  const item = objectValue(obj["item"]);
  const itemType = stringField(item, "type");
  const itemStatus = stringField(item, "status");
  if (itemType === "command_execution" && itemStatus !== "completed") {
    const command = stringField(item, "command");
    return [
      {
        type: "running",
        message: command
          ? `Running ${compactSingleLine(command, 80)}`
          : "Running command",
        toolInput: command
          ? `command: ${compactSingleLine(command, 220)}`
          : formatToolInput(item, cwd),
        toolName: "command_execution",
      },
    ];
  }
  if (itemType === "file_change") {
    const path = readablePath(stringField(item, "path"), cwd);
    return [
      {
        type: "editing",
        message: path ? `Editing ${path}` : "Editing files",
        target: path,
        toolInput: path ? `path: ${path}` : formatToolInput(item, cwd),
        toolName: "file_change",
      },
    ];
  }
  if (itemType === "agent_reasoning") {
    return [{ type: "thinking", message: "Thinking..." }];
  }
  return [];
}

function parseCodexFinalText(value: unknown): string | undefined {
  const obj = objectValue(value);
  const item = objectValue(obj["item"]);
  if (item["type"] === "agent_message") {
    return stringField(item, "text");
  }
  return undefined;
}
