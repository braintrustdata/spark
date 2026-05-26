import { stdout } from "node:process";

import { Prompt, wrapTextWithPrefix } from "@clack/core";
import pc from "picocolors";

import type { ClackWizardPrompts } from "./clack-wizard";
import type { CodingToolEvent } from "./coding-tools";

type CodingAgentOutput = {
  readonly event: (event: CodingToolEvent) => void;
  readonly fail: (message: string) => Promise<void> | void;
  readonly success: (message: string) => Promise<void> | void;
};

type StreamEntry = {
  readonly key: string;
  readonly kind: EntryKind;
  readonly status: "active" | "done" | "failed";
  readonly text: string;
};

type EntryKind = "edit" | "read" | "run" | "search" | "think";

export class ClackToolRenderer {
  private readonly output: CodingAgentOutput;
  private lastLine: string | undefined;

  constructor(prompts: ClackWizardPrompts, toolLabel: string) {
    this.output =
      prompts.codingAgentOutput?.({ toolLabel }) ??
      new CodingAgentPrompt({
        title: "Setting up Braintrust instrumentation",
      });
  }

  event(event: CodingToolEvent) {
    if (event.type === "completed" || event.type === "failed") return;

    const line = eventLine(event);
    if (line === this.lastLine) return;
    this.lastLine = line;
    this.output.event(event);
  }

  async error(message: string) {
    await this.output.fail(message);
  }

  async success(message: string) {
    await this.output.success(message);
  }
}

class CodingAgentPrompt implements CodingAgentOutput {
  private closed = false;
  private readonly done: Promise<symbol | void | undefined>;
  private entries: StreamEntry[] = [
    {
      key: "think:starting",
      kind: "think",
      status: "active",
      text: "thinking",
    },
  ];
  private frame = 0;
  private lastEventAt = 0;
  private readonly prompt: Prompt<void>;
  private result:
    | { readonly message: string; readonly type: "error" | "success" }
    | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: { readonly title: string }) {
    this.prompt = new Prompt(
      {
        render: () => this.renderFrame(options.title),
      },
      false,
    );
    this.done = this.prompt.prompt().finally(() => {
      this.closed = true;
      this.stopTimer();
    });
    this.timer = setInterval(() => {
      if (this.closed) return;
      this.frame += 1;
      this.refresh();
    }, 120);
  }

  event(event: CodingToolEvent) {
    const entry = entryForEvent(event);
    const now = Date.now();
    const keepActive = now - this.lastEventAt < 80 && entry.kind !== "think";
    this.lastEventAt = now;
    this.entries = addEntry(this.entries, entry, keepActive).slice(-9);
    this.refresh();
  }

  async fail(message: string) {
    await this.finish({ message, type: "error" });
  }

  async success(message: string) {
    await this.finish({ message, type: "success" });
  }

  private async finish(result: {
    readonly message: string;
    readonly type: "error" | "success";
  }) {
    if (this.closed) return;
    this.result = result;
    this.entries = this.entries
      .map((entry) =>
        entry.status === "active"
          ? { ...entry, status: "done" as const }
          : entry,
      )
      .slice(-9);
    this.prompt.state = "submit";
    this.refresh();
    this.closed = true;
    (this.prompt as unknown as { close: () => void }).close();
    await this.done;
  }

  private refresh() {
    if (this.closed) return;
    (this.prompt as unknown as { render: () => void }).render();
  }

  private renderFrame(title: string): string {
    const icon = this.result
      ? this.result.type === "success"
        ? pc.green("◆")
        : pc.red("◆")
      : pc.cyan(SPINNER[this.frame % SPINNER.length]);
    return [
      `${icon}  ${pc.bold(title)}`,
      ...this.entries.map((entry) => this.renderEntry(entry)),
      this.renderFooter(),
    ].join("\n");
  }

  private renderEntry(entry: StreamEntry): string {
    return wrapTextWithPrefix(
      stdout,
      statusColor(entry.status)(entry.text),
      `${pc.dim("│")} ${this.entryMarker(entry)} ${entryLabel(entry.kind)} `,
      `${pc.dim("│")}   ${pc.dim(" ".repeat(8))}`,
    );
  }

  private renderFooter(): string {
    if (this.result) {
      const color = this.result.type === "success" ? pc.green : pc.red;
      return `${pc.dim("└")}  ${color(sanitizeText(this.result.message, 140))}`;
    }
    return `${pc.dim("└")}  ${pc.dim("running")}`;
  }

  private entryMarker(entry: StreamEntry): string {
    if (entry.status === "failed") return pc.red("×");
    if (entry.status === "done") return pc.dim("✓");
    return pc.cyan(SPINNER[this.frame % SPINNER.length]);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

const SPINNER = ["◐", "◓", "◑", "◒"] as const;

function addEntry(
  entries: readonly StreamEntry[],
  entry: StreamEntry,
  keepActive: boolean,
): StreamEntry[] {
  const next = keepActive
    ? [...entries]
    : entries.map((item) =>
        item.status === "active" ? { ...item, status: "done" as const } : item,
      );
  const existingIndex = next.findIndex((item) => item.key === entry.key);
  if (existingIndex >= 0) {
    next.splice(existingIndex, 1);
  }
  return [...next, entry];
}

function entryForEvent(event: CodingToolEvent): StreamEntry {
  const kind = entryKind(event);
  const text = entryText(event, kind);
  return {
    key: `${kind}:${text}`,
    kind,
    status: "active",
    text,
  };
}

function entryKind(event: CodingToolEvent): EntryKind {
  if (event.type === "thinking") return "think";
  if (event.type === "editing") return "edit";
  if (event.type === "running") return "run";
  if (event.type === "reading") {
    const toolName = event.toolName?.toLowerCase();
    return toolName === "grep" || toolName === "glob" ? "search" : "read";
  }
  return "think";
}

function entryText(event: CodingToolEvent, kind: EntryKind): string {
  if (kind === "think") return "thinking";
  if (kind === "edit") {
    const target =
      eventTarget(event) ??
      toolInputValue(event.toolInput, ["file_path", "path", "notebook_path"]);
    return target ? `edit ${target}` : sanitizeText(event.message, 140);
  }
  if (kind === "read") {
    const target =
      eventTarget(event) ??
      toolInputValue(event.toolInput, [
        "file_path",
        "path",
        "notebook_path",
        "url",
        "query",
      ]);
    return target ? `read ${target}` : sanitizeText(event.message, 140);
  }
  if (kind === "search") {
    const query = toolInputValue(event.toolInput, [
      "pattern",
      "query",
      "glob",
      "path",
    ]);
    return query ? `search ${query}` : sanitizeText(event.message, 140);
  }
  const command =
    toolInputValue(event.toolInput, ["command"]) ??
    event.message.replace(/^Running\s+/i, "").trim();
  return command ? `run ${command}` : sanitizeText(event.message, 140);
}

function eventLine(event: CodingToolEvent): string {
  const kind = entryKind(event);
  return `${kind}:${entryText(event, kind)}`;
}

function entryLabel(kind: EntryKind): string {
  switch (kind) {
    case "edit":
      return pc.magenta("edit".padEnd(7));
    case "read":
      return pc.blue("read".padEnd(7));
    case "run":
      return pc.yellow("run".padEnd(7));
    case "search":
      return pc.blue("search".padEnd(7));
    case "think":
      return pc.cyan("think".padEnd(7));
  }
}

function statusColor(status: StreamEntry["status"]): (text: string) => string {
  if (status === "active") return pc.white;
  if (status === "failed") return pc.red;
  return pc.dim;
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
