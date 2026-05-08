/**
 * `request_command` extension.
 *
 * Lets the agent ask the user to approve a one-off command that is not in the
 * default allowed tool list (git, pkg, bt, curl, read/write/edit/grep/find/ls).
 *
 * When the agent calls this tool, the harness prints the requested command and
 * reason to stdout and reads a single line from stdin. If the user types "y"
 * or "yes" (case-insensitive), the command is executed in the current working
 * directory and the output is returned. Any other answer denies the request.
 *
 * Allows the agent to request user approval for one-off commands outside the
 * default allowed tool list.
 */

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { Type } from "typebox";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const REQUEST_PARAMS = Type.Object({
  command: Type.String({
    description: "The executable or script to run (e.g. 'npx', 'node', 'make').",
  }),
  args: Type.Array(Type.String(), {
    description: "Arguments for the command (no shell expansion).",
  }),
  reason: Type.String({
    description: "Why this command is needed — shown to the user.",
  }),
  timeout_ms: Type.Optional(
    Type.Integer({
      description: "Hard timeout in milliseconds (default 120000).",
      minimum: 1000,
      maximum: 600000,
    }),
  ),
});

type RequestParams = {
  command: string;
  args: string[];
  reason: string;
  timeout_ms?: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1_000_000;

function askUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdoutBytes += Buffer.byteLength(d);
      if (stdoutBytes < MAX_OUTPUT_BYTES) stdoutChunks.push(d);
    });
    child.stderr.on("data", (d: string) => {
      stderrBytes += Buffer.byteLength(d);
      if (stderrBytes < MAX_OUTPUT_BYTES) stderrChunks.push(d);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout: "",
        stderr: `Failed to spawn ${command}: ${err.message}`,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        timedOut,
      });
    });
  });
}

export default function requestCommandTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "request_command",
    label: "Request command approval",
    description:
      "Ask the user to approve running a command that is not in the default allowed tool list. The command only runs if the user confirms.",
    promptSnippet:
      "Use `request_command` when you need to run a tool not otherwise available (e.g. npx, node scripts, make). The user must approve each call.",
    promptGuidelines: [
      "Use this only when no other allowed tool can accomplish the task.",
      "Be specific and concise in the `reason` field.",
      "Pass argv as an array — do not embed shell quoting.",
      "The user sees the full command and reason before deciding.",
    ],
    parameters: REQUEST_PARAMS,
    async execute(_toolCallId, params) {
      const p = params as RequestParams;
      const fullCommand = [p.command, ...p.args].join(" ");

      const answer = await askUser(
        [
          "",
          "┌─ bt-wizard: command approval requested ──────────────",
          `│  Command : ${fullCommand}`,
          `│  Reason  : ${p.reason}`,
          "│",
          "│  Allow this command? [y/N]: ",
        ].join("\n"),
      );

      if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
        return {
          content: [
            {
              type: "text",
              text: `Command denied by user: ${fullCommand}`,
            },
          ],
          details: { approved: false },
        };
      }

      const result = await runCommand(
        p.command,
        p.args,
        p.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        process.cwd(),
      );
      const summary = result.timedOut
        ? `${p.command} timed out (exit ${result.exitCode})`
        : `${p.command} exited ${result.exitCode}`;
      return {
        content: [
          {
            type: "text",
            text: [
              summary,
              "--- stdout ---",
              result.stdout,
              "--- stderr ---",
              result.stderr,
            ].join("\n"),
          },
        ],
        details: {
          approved: true,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        },
      };
    },
  });
}
