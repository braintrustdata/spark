/**
 * `bt` CLI extension.
 *
 * The bt-wizard harness disables `bash`, but the agent still needs to invoke
 * the Braintrust `bt` CLI. We expose `bt` as a first-class tool so
 * the model can call it with a structured argv and stdin instead of a raw
 * shell line.
 *
 * Argv is an array of strings — no shell metacharacter interpretation. stdin
 * is optional plain text. The tool spawns the `bt` binary directly with
 * `shell: false`.
 */

import { spawn } from "node:child_process";
import { Type } from "typebox";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const BT_PARAMS = Type.Object({
  args: Type.Array(Type.String(), {
    description:
      "Argv passed to the bt CLI (no shell expansion). Example: ['status','--json'].",
  }),
  stdin: Type.Optional(
    Type.String({
      description: "Optional text written to bt's stdin.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({
      description: "Hard timeout in milliseconds (default 60000).",
      minimum: 1000,
      maximum: 600000,
    }),
  ),
});

type BtParams = {
  args: string[];
  stdin?: string;
  timeout_ms?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1_000_000;

function runBt(params: BtParams): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn("bt", params.args, {
      stdio: ["pipe", "pipe", "pipe"],
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
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, params.timeout_ms ?? DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdoutBytes += Buffer.byteLength(d);
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        stdoutChunks.push(d);
      }
    });
    child.stderr.on("data", (d: string) => {
      stderrBytes += Buffer.byteLength(d);
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        stderrChunks.push(d);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout: "",
        stderr: `Failed to spawn bt: ${err.message}`,
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

    if (params.stdin && params.stdin.length > 0) {
      child.stdin.write(params.stdin);
    }
    child.stdin.end();
  });
}

export default function btTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "bt",
    label: "bt CLI",
    description:
      "Run the Braintrust `bt` CLI with a structured argv. Use for `bt status`, `bt sql`, etc.",
    promptSnippet:
      "Invoke `bt` for Braintrust CLI operations (status, queries, project info). bash/python are not available.",
    promptGuidelines: [
      "Pass argv as an array — do not embed shell quoting.",
      "Prefer `bt status --json` to inspect the active org/project.",
      "Use `bt sql --json` for BTQL queries to verify traces; include a timestamp filter.",
    ],
    parameters: BT_PARAMS,
    async execute(_toolCallId, params) {
      const result = await runBt(params as BtParams);
      const summary = result.timedOut
        ? `bt timed out (exit ${result.exitCode})`
        : `bt exited ${result.exitCode}`;
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
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        },
      };
    },
  });
}
