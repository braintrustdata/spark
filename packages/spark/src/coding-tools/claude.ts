import { execCapture, versionOf } from "./process";
import type {
  Adapter,
  CaptureResult,
  CodingToolEvent,
  CodingToolStatus,
} from "./types";
import {
  firstNonEmptyLine,
  formatToolInput,
  objectValue,
  parseJsonObject,
  readablePath,
  stringField,
} from "./utils";

export const claudeAdapter: Adapter = {
  id: "claude",
  label: "Claude Code",
  command: "claude",
  status: claudeStatus,
  smokeCommand: ({ commandPath, cwd, prompt }) => ({
    command: commandPath,
    args: [
      "-p",
      "--model",
      "haiku",
      "--effort",
      "low",
      "--verbose",
      "--output-format",
      "stream-json",
      "--no-session-persistence",
      "--tools",
      "",
    ],
    stdin: prompt,
    cwd,
  }),
  runCommand: ({ commandPath, cwd, prompt, env }) => ({
    command: commandPath,
    args: [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--no-session-persistence",
      "--tools",
      "default",
      "--permission-mode",
      "bypassPermissions",
      "--dangerously-skip-permissions",
    ],
    stdin: prompt,
    cwd,
    env,
  }),
  parseEvents: parseClaudeEvents,
  parseFinalText: parseClaudeFinalText,
};

async function claudeStatus(commandPath: string): Promise<CodingToolStatus> {
  const [version, auth] = await Promise.all([
    versionOf(commandPath),
    execCapture(commandPath, ["auth", "status", "--json"]),
  ]);
  return claudeStatusFromResult(commandPath, version, auth);
}

export function claudeStatusFromResult(
  commandPath: string,
  version: string | undefined,
  auth: Pick<CaptureResult, "exitCode" | "stdout" | "stderr">,
): CodingToolStatus {
  const base = {
    id: "claude" as const,
    label: "Claude Code",
    command: commandPath,
    installed: true,
    version,
  };
  if (auth.exitCode !== 0) {
    return {
      ...base,
      usable: false,
      unavailableReason:
        firstNonEmptyLine(auth.stderr, auth.stdout) ??
        "Claude Code is not logged in.",
    };
  }
  const parsed = parseJsonObject(auth.stdout);
  const loggedIn = parsed["loggedIn"] === true;
  const authMethod = stringField(parsed, "authMethod");
  const subscriptionType = stringField(parsed, "subscriptionType");
  if (!loggedIn) {
    return {
      ...base,
      usable: false,
      authMode: authMethod,
      unavailableReason: "Claude Code is not logged in.",
    };
  }
  return {
    ...base,
    usable: true,
    authMode: subscriptionType
      ? `${authMethod ?? "claude.ai"} (${subscriptionType})`
      : authMethod,
  };
}

export function parseClaudeEvents(
  value: unknown,
  cwd: string,
): readonly CodingToolEvent[] {
  const obj = objectValue(value);
  if (obj["type"] === "system") {
    return [{ type: "thinking", message: "Thinking..." }];
  }
  if (obj["type"] === "assistant") {
    const message = objectValue(obj["message"]);
    const content = Array.isArray(message["content"]) ? message["content"] : [];
    const events: CodingToolEvent[] = [];
    for (const block of content) {
      const parsed = objectValue(block);
      if (parsed["type"] === "thinking") {
        events.push({ type: "thinking", message: "Thinking..." });
      }
      if (parsed["type"] === "tool_use") {
        events.push(claudeToolUseEvent(parsed, cwd));
      }
    }
    return events;
  }
  if (obj["type"] === "result") {
    return [
      {
        type: obj["is_error"] === true ? "failed" : "completed",
        message:
          obj["is_error"] === true ? "Tool run failed." : "Tool run completed.",
      },
    ];
  }
  return [];
}

export function parseClaudeEvent(
  value: unknown,
  cwd: string,
): CodingToolEvent | undefined {
  return parseClaudeEvents(value, cwd)[0];
}

function claudeToolUseEvent(
  block: Record<string, unknown>,
  cwd: string,
): CodingToolEvent {
  const name = stringField(block, "name") ?? "tool";
  const input = objectValue(block["input"]);
  const tool = {
    toolInput: formatToolInput(input, cwd),
    toolName: name,
  };
  const fileTarget = readablePath(
    stringField(input, "file_path") ??
      stringField(input, "path") ??
      stringField(input, "notebook_path"),
    cwd,
  );
  switch (name.toLowerCase()) {
    case "read":
    case "ls":
      return {
        type: "reading",
        message: fileTarget ? `Reading ${fileTarget}` : "Reading files",
        target: fileTarget,
        ...tool,
      };
    case "grep":
    case "glob":
      return { type: "reading", message: "Searching files", ...tool };
    case "write":
    case "edit":
    case "multiedit":
    case "notebookedit":
      return {
        type: "editing",
        message: fileTarget ? `Editing ${fileTarget}` : "Editing files",
        target: fileTarget,
        ...tool,
      };
    case "bash":
      return { type: "running", message: "Running command", ...tool };
    case "webfetch":
    case "websearch":
      return { type: "reading", message: "Reading documentation", ...tool };
    case "todowrite":
      return { type: "thinking", message: "Planning changes...", ...tool };
    default:
      return { type: "thinking", message: `Calling ${name}`, ...tool };
  }
}

function parseClaudeFinalText(value: unknown): string | undefined {
  const obj = objectValue(value);
  if (obj["type"] === "result") return stringField(obj, "result");
  const message = objectValue(obj["message"]);
  const content = Array.isArray(message["content"]) ? message["content"] : [];
  const text = content
    .map((block) => {
      const parsed = objectValue(block);
      return parsed["type"] === "text"
        ? stringField(parsed, "text")
        : undefined;
    })
    .filter((part): part is string => part !== undefined)
    .join("\n");
  return text.length > 0 ? text : undefined;
}
