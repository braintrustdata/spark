/**
 * Package-manager / formatter / linter / test-runner extension.
 *
 * Exposes a `pkg` tool so the agent can run language tooling without needing
 * bash. The allowed tools are gated by the languages detected by bt-wizard,
 * passed in via the `BT_WIZARD_LANGUAGES` environment variable.
 *
 * If no languages are detected, all known tools are permitted.
 *
 * Per-language allowlists:
 *
 * Python
 *   pkg managers: conda, hatch, mamba, pdm, pip, pipenv, pipx, poetry, rye, uv
 *   formatters:   autopep8, black, isort, ruff, yapf
 *   linters:      flake8, mypy, pylint, pyright, ruff
 *   test:         coverage, nose2, pytest, tox, unittest
 *
 * JavaScript / TypeScript
 *   pkg managers: bun, deno, ni, npm, pnpm, yarn
 *   formatters:   biome, dprint, prettier
 *   linters:      biome, eslint, oxlint
 *   test:         ava, jasmine, jest, mocha, vitest
 *
 * Go
 *   pkg managers: dep, glide, go
 *   formatters:   gofmt, gofumpt, goimports
 *   linters:      golangci-lint, revive, staticcheck
 *   test:         ginkgo, gomock, testify
 *
 * C#
 *   pkg managers: choco, dotnet, nuget, paket
 *   formatters:   csharpier, dotnet
 *   linters:      dotnet
 *   test:         dotnet
 *
 * Java
 *   pkg managers: bazel, gradle, ivy, mvn, mill, sbt
 *   formatters:   checkstyle, google-java-format, spotless
 *   linters:      checkstyle, pmd, spotbugs
 *   test:         gradle, mvn, sbt
 *
 * Ruby
 *   pkg managers: asdf, bundle, gem, rbenv, rvm
 *   formatters:   rubocop, rufo, standardrb
 *   linters:      brakeman, reek, rubocop, standardrb
 *   test:         cucumber, minitest, rspec, test-unit
 */

import { spawn } from "node:child_process";
import { Type } from "typebox";

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

type Language = "python" | "typescript" | "go" | "csharp" | "java" | "ruby";

const LANGUAGE_TOOLS: Record<Language, readonly string[]> = {
  python: [
    // interpreters
    "python", "python3",
    // package managers
    "conda", "hatch", "mamba", "pdm", "pip", "pipenv", "pipx", "poetry", "rye", "uv",
    // formatters
    "autopep8", "black", "isort", "yapf",
    // linters
    "flake8", "mypy", "pylint", "pyright",
    // ruff handles both formatting and linting
    "ruff",
    // test
    "coverage", "nose2", "pytest", "tox", "unittest",
  ],
  typescript: [
    // interpreters / runtimes
    "node", "npx", "ts-node", "tsx",
    // package managers (bun and deno double as runtimes)
    "bun", "deno", "ni", "npm", "pnpm", "yarn",
    // formatters
    "dprint", "prettier",
    // linters
    "eslint", "oxlint",
    // biome handles formatting + linting
    "biome",
    // test
    "ava", "jasmine", "jest", "mocha", "vitest",
  ],
  go: [
    // interpreter/compiler (go run, go build, go test, go mod …)
    "dep", "glide", "go",
    // formatters
    "gofmt", "gofumpt", "goimports",
    // linters
    "golangci-lint", "revive", "staticcheck",
    // test (go test is via "go", others are standalone)
    "ginkgo", "gomock", "testify",
  ],
  csharp: [
    // runtime / package managers / build — dotnet covers all of these
    "dotnet",
    // package managers
    "choco", "nuget", "paket",
    // formatters + linters
    "csharpier",
  ],
  java: [
    // interpreter / compiler
    "java", "javac",
    // package managers / build tools
    "bazel", "gradle", "ivy", "mvn", "mill", "sbt",
    // formatters / linters
    "checkstyle", "google-java-format", "spotless", "pmd", "spotbugs",
  ],
  ruby: [
    // interpreter
    "ruby",
    // package managers
    "asdf", "bundle", "gem", "rbenv", "rvm",
    // formatters + linters (rubocop / standardrb handle both)
    "rubocop", "rufo", "standardrb",
    // linters
    "brakeman", "reek",
    // test
    "cucumber", "minitest", "rspec", "test-unit",
  ],
};

// Always allowed regardless of detected language.
const UNIVERSAL_TOOLS: ReadonlySet<string> = new Set(["env"]);

const ALL_TOOLS: ReadonlySet<string> = new Set([
  ...UNIVERSAL_TOOLS,
  ...(Object.values(LANGUAGE_TOOLS) as readonly string[][]).flat(),
]);

function allowedTools(): ReadonlySet<string> {
  const raw = process.env["BT_WIZARD_LANGUAGES"] ?? "";
  const langs = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Language => s.length > 0 && s in LANGUAGE_TOOLS);
  if (langs.length === 0) {
    return ALL_TOOLS;
  }
  const allowed = new Set<string>([...UNIVERSAL_TOOLS]);
  for (const lang of langs) {
    for (const tool of LANGUAGE_TOOLS[lang]) {
      allowed.add(tool);
    }
  }
  return allowed;
}

const PKG_PARAMS = Type.Object({
  manager: Type.String({
    description:
      "Tool binary name (package manager, formatter, linter, or test runner — e.g. npm, pip, go, pytest, eslint). Must be in the allowed list for the project's language.",
  }),
  args: Type.Array(Type.String(), {
    description:
      "Arguments passed to the package manager (no shell expansion). Example: ['install', 'braintrust'].",
  }),
  timeout_ms: Type.Optional(
    Type.Integer({
      description: "Hard timeout in milliseconds (default 120000).",
      minimum: 1000,
      maximum: 600000,
    }),
  ),
});

type PkgParams = {
  manager: string;
  args: string[];
  timeout_ms?: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STREAM_BYTES = 500;

function tailTruncate(s: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(s, "utf8");
  if (buf.byteLength <= maxBytes) return { text: s, truncated: false };
  return { text: buf.slice(-maxBytes).toString("utf8"), truncated: true };
}

function runPkg(
  manager: string,
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
    const child = spawn(manager, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

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
    child.stdout.on("data", (d: string) => { stdoutChunks.push(d); });
    child.stderr.on("data", (d: string) => { stderrChunks.push(d); });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout: "",
        stderr: `Failed to spawn ${manager}: ${err.message}`,
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

export default function packageManagerTool(pi: ExtensionAPI) {
  const allowed = allowedTools();
  const allowedList = [...allowed].sort().join(", ");

  pi.registerTool({
    name: "pkg",
    label: "language tooling",
    description: `Run language package managers, formatters, linters, and test runners. Allowed tools for this project: ${allowedList}.`,
    promptSnippet:
      "Use `pkg` to run package managers, formatters, linters, and test runners (npm, pip, pytest, eslint, etc.). bash/python are not available.",
    promptGuidelines: [
      `Allowed tools: ${allowedList}.`,
      "Pass argv as an array — do not embed shell quoting.",
      "Example: manager='npm', args=['install','braintrust']",
      "Example: manager='pytest', args=['tests/']",
      "The command runs in the current working directory.",
    ],
    parameters: PKG_PARAMS,
    renderShell: "self",
    renderCall(args: PkgParams, theme: Theme) {
      const cmd = [args.manager, ...args.args].join(" ");
      return new Text(theme.fg("toolTitle", "$ ") + theme.fg("accent", cmd), 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const details = result.details as { exitCode?: number; timedOut?: boolean; blocked?: boolean } | undefined;
      const a = context.args as PkgParams;
      const cmd = [a.manager, ...a.args].join(" ");

      if (details?.blocked) {
        return new Text(theme.fg("toolTitle", "$ ") + theme.fg("accent", cmd) + "  →  " + theme.fg("error", "blocked"), 0, 0);
      }

      const exitCode = details?.exitCode ?? -1;
      const timedOut = details?.timedOut ?? false;
      const status = timedOut
        ? theme.fg("warning", `timed out (exit ${exitCode})`)
        : exitCode === 0
          ? theme.fg("success", `exit ${exitCode}`)
          : theme.fg("error", `exit ${exitCode}`);

      return new Text(theme.fg("toolTitle", "$ ") + theme.fg("accent", cmd) + "  →  " + status, 0, 0);
    },
    async execute(_toolCallId, params) {
      const p = params as PkgParams;
      const mgr = p.manager.trim().toLowerCase();

      if (!allowed.has(mgr)) {
        return {
          content: [
            {
              type: "text",
              text: [
                `error: "${mgr}" is not an allowed tool for this project.`,
                `Allowed: ${allowedList}.`,
                `Use request_command if you need a different tool.`,
              ].join("\n"),
            },
          ],
          details: { blocked: true, manager: mgr },
        };
      }

      const result = await runPkg(
        mgr,
        p.args,
        p.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        process.cwd(),
      );
      const cmd = [mgr, ...p.args].join(" ");
      const summary = result.timedOut
        ? `$ ${cmd}  →  timed out (exit ${result.exitCode})`
        : `$ ${cmd}  →  exit ${result.exitCode}`;
      const out = tailTruncate(result.stdout, MAX_STREAM_BYTES);
      const err = tailTruncate(result.stderr, MAX_STREAM_BYTES);
      const parts: string[] = [summary];
      if (out.text) {
        if (out.truncated) parts.push("--- stdout (last 500B) ---");
        else parts.push("--- stdout ---");
        parts.push(out.text);
      }
      if (err.text) {
        if (err.truncated) parts.push("--- stderr (last 500B) ---");
        else parts.push("--- stderr ---");
        parts.push(err.text);
      }
      return {
        content: [{ type: "text", text: parts.join("\n") }],
        details: { exitCode: result.exitCode, timedOut: result.timedOut },
      };
    },
  });
}
