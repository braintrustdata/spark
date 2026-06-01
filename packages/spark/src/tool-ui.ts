import { taskLog } from "@clack/prompts";

import type { CodingToolEvent } from "./coding-tools";

type CodingAgentOutput = {
  readonly message: (message: string) => Promise<void> | void;
  readonly fail: (message: string) => Promise<void> | void;
  readonly success: (message: string) => Promise<void> | void;
};

export class ClackToolRenderer {
  private output: CodingAgentOutput | undefined;
  private lastLine: string | undefined;

  constructor(private readonly toolLabel: string) {}

  private getOutput(): CodingAgentOutput {
    return this.start();
  }

  start() {
    if (!this.output) {
      const title = `Running ${this.toolLabel} to instrument your application`;
      this.output = new TaskLogCodingAgentOutput(title);
    }

    return this.output;
  }

  event(event: CodingToolEvent) {
    if (event.type === "completed" || event.type === "failed") return;

    const line = eventLine(event);
    if (line === this.lastLine) return;
    this.lastLine = line;
    void this.getOutput().message(line);
  }

  async error(message: string) {
    await this.getOutput().fail(message);
  }

  async success(message: string) {
    await this.getOutput().success(message);
  }
}

class TaskLogCodingAgentOutput implements CodingAgentOutput {
  private readonly log: Pick<
    ReturnType<typeof taskLog>,
    "error" | "message" | "success"
  >;

  constructor(title: string) {
    this.log = taskLog({
      title,
      limit: 9,
      spacing: 0,
      retainLog: false,
    });
  }

  message(message: string) {
    this.log.message(message);
  }

  fail(message: string) {
    this.log.error(message);
  }

  success(message: string) {
    this.log.success(message);
  }
}

function eventLine(event: CodingToolEvent): string {
  if (event.type === "thinking") return "thinking";
  if (event.type === "editing") {
    const target =
      eventTarget(event) ??
      toolInputValue(event.toolInput, ["file_path", "path", "notebook_path"]);
    return actionLine("edit", target ?? event.message);
  }
  if (event.type === "reading") {
    const target =
      eventTarget(event) ??
      toolInputValue(event.toolInput, [
        "file_path",
        "path",
        "notebook_path",
        "url",
        "query",
      ]);
    return actionLine("read", target ?? event.message);
  }

  const command =
    toolInputValue(event.toolInput, ["command"]) ??
    event.message.replace(/^Running\s+/i, "").trim();
  return actionLine("run", command);
}

function actionLine(action: string, value: string | undefined): string {
  const text = value ? sanitizeText(value, 140) : "";
  return text ? `${action} ${text}` : action;
}

function eventTarget(event: CodingToolEvent): string | undefined {
  return "target" in event ? event.target : undefined;
}

function toolInputValue(
  input: string | undefined,
  keys: readonly string[],
): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const marker = `${key}: `;
    const start = input.indexOf(marker);
    if (start < 0) continue;
    const rest = input.slice(start + marker.length);
    const nextField = rest.search(/, [a-zA-Z_][\w-]*: /);
    const value = (nextField >= 0 ? rest.slice(0, nextField) : rest).trim();
    if (value) return sanitizeText(value, 140);
  }
  return undefined;
}

function sanitizeText(value: string, maxLength: number): string {
  const withoutAnsi = value.replace(
    // eslint-disable-next-line no-control-regex
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    "",
  );
  const singleLine = withoutAnsi
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}
