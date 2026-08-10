import {
  claudeAdapter,
  claudeStatusFromResult,
  parseClaudeEvent,
  parseClaudeEvents,
} from "./claude";
import { codexAdapter, codexStatusFromResult, parseCodexEvent } from "./codex";
import { findCommand, runToolCommand } from "./process";
import type {
  Adapter,
  CodingToolEvent,
  CodingToolId,
  CodingToolRunResult,
  CodingToolStatus,
  CommandSpec,
} from "./types";

const SMOKE_PROMPT = "Reply with exactly BRAINTRUST_SETUP_TOOL_OK.";
const ADAPTERS: readonly Adapter[] = [claudeAdapter, codexAdapter];

export function codingToolLabel(id: CodingToolId): string {
  return adapterFor(id).label;
}

export async function discoverCodingTools(): Promise<
  readonly CodingToolStatus[]
> {
  return await Promise.all(
    ADAPTERS.map(async (adapter) => {
      const commandPath = await findCommand(adapter.command);
      if (!commandPath) {
        return {
          id: adapter.id,
          label: adapter.label,
          command: adapter.command,
          installed: false,
          usable: false,
          unavailableReason: `${adapter.command} was not found on PATH.`,
          unavailableReasonCode: "not_detected",
        };
      }
      return await adapter.status(commandPath);
    }),
  );
}

export async function smokeTestCodingTool(args: {
  readonly id: CodingToolId;
  readonly cwd: string;
  readonly onEvent?: (event: CodingToolEvent) => void;
}): Promise<CodingToolRunResult> {
  const adapter = adapterFor(args.id);
  const commandPath = await requireCommand(adapter);
  const result = await runToolCommand(
    adapter,
    adapter.smokeCommand({
      commandPath,
      cwd: args.cwd,
      prompt: SMOKE_PROMPT,
    }),
    args.onEvent,
  );
  if (
    result.exitCode !== 0 ||
    !result.finalText.includes("BRAINTRUST_SETUP_TOOL_OK")
  ) {
    throw new Error(
      `${adapter.label} could not complete a smoke prompt. ${summarizeFailure(result)}`,
    );
  }
  return result;
}

export async function runCodingTool(args: {
  readonly id: CodingToolId;
  readonly cwd: string;
  readonly prompt: string;
  readonly env: NodeJS.ProcessEnv;
  readonly onEvent?: (event: CodingToolEvent) => void;
}): Promise<CodingToolRunResult> {
  const adapter = adapterFor(args.id);
  const commandPath = await requireCommand(adapter);
  return await runToolCommand(
    adapter,
    adapter.runCommand({
      commandPath,
      cwd: args.cwd,
      prompt: args.prompt,
      env: args.env,
    }),
    args.onEvent,
  );
}

export function buildClaudeCommandForTest(args: {
  readonly commandPath: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly env: NodeJS.ProcessEnv;
}): CommandSpec {
  return adapterFor("claude").runCommand(args);
}

export function buildCodexCommandForTest(args: {
  readonly commandPath: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly env: NodeJS.ProcessEnv;
}): CommandSpec {
  return adapterFor("codex").runCommand(args);
}

export function parseClaudeEventForTest(
  value: unknown,
  cwd: string,
): CodingToolEvent | undefined {
  return parseClaudeEvent(value, cwd);
}

export function parseClaudeEventsForTest(
  value: unknown,
  cwd: string,
): readonly CodingToolEvent[] {
  return parseClaudeEvents(value, cwd);
}

export function parseCodexEventForTest(
  value: unknown,
  cwd: string,
): CodingToolEvent | undefined {
  return parseCodexEvent(value, cwd);
}

export function parseClaudeStatusForTest(args: {
  readonly commandPath: string;
  readonly version?: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}): CodingToolStatus {
  return claudeStatusFromResult(args.commandPath, args.version, args);
}

export function parseCodexStatusForTest(args: {
  readonly commandPath: string;
  readonly version?: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}): CodingToolStatus {
  return codexStatusFromResult(args.commandPath, args.version, args);
}

function adapterFor(id: CodingToolId): Adapter {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`Unknown coding tool: ${id}`);
  return adapter;
}

async function requireCommand(adapter: Adapter): Promise<string> {
  const commandPath = await findCommand(adapter.command);
  if (!commandPath) {
    throw new Error(`${adapter.label} was not found on PATH.`);
  }
  return commandPath;
}

function summarizeFailure(result: CodingToolRunResult): string {
  const output = result.finalText.trim();
  if (output.length === 0) return `Exit code: ${result.exitCode}.`;
  return output.length > 500 ? output.slice(0, 500) : output;
}
