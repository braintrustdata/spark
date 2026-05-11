/**
 * `git` extension.
 *
 * Exposes a structured `git` tool. An allowlist of safe subcommands is
 * enforced; destructive remote and force operations are blocked.
 *
 * Allowed: read-only queries (status, log, diff, show, blame, grep, ls-files,
 *   ls-tree, rev-parse, describe, branch, tag, shortlog) plus staging and
 *   committing (add, commit) and file-level restore (checkout, restore).
 *
 * Blocked: push, pull, fetch, clone, remote, reset --hard, clean -f, and
 *   any subcommand not in the allowlist.
 */

import { spawn } from "node:child_process";
import { Type } from "typebox";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const ALLOWED_SUBCOMMANDS = new Set([
  // read-only
  "status",
  "log",
  "diff",
  "show",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "ls-remote",
  "rev-parse",
  "rev-list",
  "describe",
  "branch",
  "tag",
  "shortlog",
  "stash",
  "format-patch",
  // staging / committing
  "add",
  "commit",
  // file-level restore (must be used with a path, not to switch branches)
  "checkout",
  "restore",
  // submodule inspection
  "submodule",
]);

// argv elements that make otherwise-safe subcommands dangerous
const BLOCKED_FLAGS = new Set([
  "--force",
  "-f",
  "--hard",
  "--delete",
  "-D",
  "--mirror",
  "--all",
]);

// Subcommand-specific blocks regardless of flags
const BLOCKED_SUBCOMMANDS = new Set([
  "push",
  "pull",
  "fetch",
  "clone",
  "remote",
  "clean",
  "rebase",
  "merge",
  "cherry-pick",
  "revert",
  "bisect",
  "reflog",
  "gc",
  "fsck",
  "filter-branch",
  "am",
  "apply",
]);

const GIT_PARAMS = Type.Object({
  args: Type.Array(Type.String(), {
    description:
      "Argv passed to git (no shell expansion). Example: ['status', '--short'].",
  }),
  stdin: Type.Optional(
    Type.String({
      description: "Optional text written to git's stdin.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({
      description: "Hard timeout in milliseconds (default 30000).",
      minimum: 1000,
      maximum: 120000,
    }),
  ),
});

type GitParams = {
  args: string[];
  stdin?: string;
  timeout_ms?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 500_000;

function runGit(
  params: GitParams,
  cwd: string,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn("git", params.args, {
      cwd,
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
        stderr: `Failed to spawn git: ${err.message}`,
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

export default function gitTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "git",
    label: "git",
    description:
      "Run safe git commands (read-only queries, add, commit, checkout/restore for files). Push, pull, fetch, remote modifications, and destructive resets are blocked.",
    promptSnippet:
      "Use `git` for version-control operations: status, log, diff, add, commit. bash/python are not available.",
    promptGuidelines: [
      "Pass argv as an array — do not embed shell quoting.",
      "Use `git status` and `git diff` to inspect changes before committing.",
      "Use `git add <path>` then `git commit -m '...'` to stage and commit SDK changes.",
      "Push, pull, fetch, and destructive resets are blocked.",
    ],
    parameters: GIT_PARAMS,
    async execute(_toolCallId, params) {
      const p = params as GitParams;
      const subcommand = p.args[0];

      if (!subcommand) {
        return {
          content: [{ type: "text", text: "error: no git subcommand given" }],
          details: { blocked: true },
        };
      }

      if (BLOCKED_SUBCOMMANDS.has(subcommand)) {
        return {
          content: [
            {
              type: "text",
              text: `error: git ${subcommand} is not permitted in the bt-wizard harness.`,
            },
          ],
          details: { blocked: true, subcommand },
        };
      }

      if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
        return {
          content: [
            {
              type: "text",
              text: `error: git ${subcommand} is not in the allowed list. Use request_command if you need it.`,
            },
          ],
          details: { blocked: true, subcommand },
        };
      }

      // Block dangerous flags on otherwise-allowed subcommands.
      // Exception: `git checkout -f` on a file path is still blocked.
      for (const arg of p.args.slice(1)) {
        if (BLOCKED_FLAGS.has(arg)) {
          return {
            content: [
              {
                type: "text",
                text: `error: flag "${arg}" is not permitted in git ${subcommand}.`,
              },
            ],
            details: { blocked: true, flag: arg },
          };
        }
      }

      const result = await runGit(p, process.cwd());
      const summary = result.timedOut
        ? `git timed out (exit ${result.exitCode})`
        : `git exited ${result.exitCode}`;
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
        details: { exitCode: result.exitCode, timedOut: result.timedOut },
      };
    },
  });
}
