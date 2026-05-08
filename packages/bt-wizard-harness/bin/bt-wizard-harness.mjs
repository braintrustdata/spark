#!/usr/bin/env node
/**
 * Thin launcher for the bt-wizard pi harness.
 *
 * Usage: bt-wizard-harness --prompt-file <path> [extra pi args...]
 *
 * Wraps `pi` (the @mariozechner/pi-coding-agent CLI) with:
 *   --no-builtin-tools                     → start from a clean slate
 *   -t read,write,edit,grep,find,ls
 *   -e <path-guard>                        → enforce path scope
 *   -e <bt-tool>                           → expose `bt` as a tool
 *   -e <curl-tool>                         → GET/HEAD-only HTTP fetcher
 *   -e <git-tool>                          → safe git subcommands
 *   -e <package-manager-tool>             → language-gated package managers
 *   -e <request-command-tool>             → user-approved one-off commands
 *   --append-system-prompt <prompt>        → bt setup instrumentation prompt
 *
 * No bash/python — stateful work goes through bt, git, or pkg tools.
 * BT_WIZARD_LANGUAGES controls which package managers are allowed.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");

const argv = process.argv.slice(2);
let promptFile;
const passthrough = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--prompt-file") {
    promptFile = argv[i + 1];
    i += 1;
  } else if (a === "-h" || a === "--help") {
    process.stdout.write(
      "Usage: bt-wizard-harness --prompt-file <path> [extra pi args...]\n",
    );
    process.exit(0);
  } else {
    passthrough.push(a);
  }
}

if (!promptFile) {
  process.stderr.write("error: --prompt-file is required\n");
  process.exit(2);
}
if (!existsSync(promptFile)) {
  process.stderr.write(`error: prompt file not found: ${promptFile}\n`);
  process.exit(2);
}

const promptText = readFileSync(promptFile, "utf8");

const piArgs = [
  "--no-builtin-tools",
  "-t",
  "read,write,edit,grep,find,ls",
  "-e",
  resolve(pkgDir, "extensions/path-guard.ts"),
  "-e",
  resolve(pkgDir, "extensions/bt-tool.ts"),
  "-e",
  resolve(pkgDir, "extensions/curl-tool.ts"),
  "-e",
  resolve(pkgDir, "extensions/git-tool.ts"),
  "-e",
  resolve(pkgDir, "extensions/package-manager-tool.ts"),
  "-e",
  resolve(pkgDir, "extensions/request-command-tool.ts"),
  "--append-system-prompt",
  promptText,
  ...passthrough,
  // Initial user message — triggers the agent immediately without waiting for
  // user input. The full instructions are already in the system prompt above.
  "Begin the Braintrust SDK installation task.",
];

// Resolve the `pi` binary from the workspace's node_modules. Falling back to
// `pi` on PATH if it isn't there (e.g. when this package is installed
// globally via `pi install`).
const candidates = [
  resolve(pkgDir, "..", "..", "node_modules", ".bin", "pi"),
  resolve(pkgDir, "node_modules", ".bin", "pi"),
];
let piBin = "pi";
for (const c of candidates) {
  if (existsSync(c)) {
    piBin = c;
    break;
  }
}

const child = spawn(piBin, piArgs, {
  stdio: "inherit",
  cwd: process.cwd(),
});
child.on("error", (err) => {
  process.stderr.write(`failed to spawn ${piBin}: ${err.message}\n`);
  process.exit(127);
});
child.on("close", (code) => {
  process.exit(code ?? 0);
});
