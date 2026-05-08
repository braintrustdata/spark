#!/usr/bin/env node
/**
 * Thin launcher for the bt-wizard pi harness.
 *
 * Usage: bt-wizard-harness --prompt-file <path> [extra pi args...]
 *
 * Runs pi inside a PTY so it gets a real terminal: correct window size,
 * ANSI colours, cursor control, and automatic resize on SIGWINCH.
 * We intercept the PTY output to scan for "summary" (case-insensitive);
 * when detected we kill pi and exit so the wizard can run its cleanup phase.
 *
 * Tools loaded (--no-builtin-tools baseline):
 *   read,write,edit,grep,find,ls  built-in file ops
 *   path-guard                    restrict writes to cwd / .env.braintrust
 *   bt-tool                       bt CLI
 *   curl-tool                     GET/HEAD only HTTP
 *   git-tool                      safe git subcommands
 *   package-manager-tool          language-gated pkg/fmt/lint/test
 *   request-command-tool          user-approved one-off commands
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

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

// Resolve pi's actual JS entry point so node-pty can spawn `node <path>`
// directly. The .bin/pi shim is a POSIX shell script that node-pty cannot
// exec via posix_spawnp, so we must bypass it.
function resolvePiJs() {
  const shimCandidates = [
    resolve(pkgDir, "node_modules", ".bin", "pi"),
    resolve(pkgDir, "..", "..", "node_modules", ".bin", "pi"),
  ];
  for (const shim of shimCandidates) {
    if (!existsSync(shim)) continue;
    // The shim contains: exec node "$basedir/../../../../path/to/cli.js" "$@"
    // $basedir is the directory containing the shim file.
    const shimDir = dirname(shim);
    const content = readFileSync(shim, "utf8");
    const m = content.match(/exec\s+\S*node\S*\s+"([^"]+\.js)"/);
    if (!m) continue;
    // Replace the literal "$basedir" token with the shim's directory.
    const jsPath = resolve(m[1].replace("$basedir", shimDir));
    if (existsSync(jsPath)) return jsPath;
  }
  return null;
}

const piJs = resolvePiJs();
// spawn args: if we found the JS file, use `node <file>`; else fall back to
// spawning the `pi` executable directly (works if installed globally as a
// real binary rather than a pnpm shim).
const [spawnBin, spawnArgs] = piJs
  ? [process.execPath, [piJs]]
  : ["pi", []];

const piArgs = [
  "--no-session",
  "--no-builtin-tools",
  "-t",
  "read,write,edit,grep,find,ls,bt,pkg,curl,git,request_command",
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
];

// ---------------------------------------------------------------------------
// PTY spawn — pi sees a real terminal on all three fds
// ---------------------------------------------------------------------------

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 24;

const piProc = pty.spawn(spawnBin, [...spawnArgs, ...piArgs], {
  name: process.env.TERM ?? "xterm-256color",
  cols,
  rows,
  cwd: process.cwd(),
  env: process.env,
});

// ---------------------------------------------------------------------------
// Summary detection
// ---------------------------------------------------------------------------

// Scan a sliding window so "summary" split across chunks is still caught.
const SUMMARY_WORD = "summary";
const WINDOW = SUMMARY_WORD.length - 1;

let tail = "";
let summaryDetected = false;
// While the user is typing, pause scanning so echoed keystrokes don't trigger
// shutdown. The timer is reset on every keystroke and expires 150 ms after the
// last one — well before any agent response could arrive.
let userTypingTimer = null;

function shutdown() {
  if (summaryDetected) return;
  summaryDetected = true;
  setTimeout(() => {
    try {
      piProc.kill("SIGTERM");
    } catch {
      // already gone
    }
  }, 200).unref();
}

piProc.onData((data) => {
  process.stdout.write(data);

  if (summaryDetected || userTypingTimer) return;

  const text = tail + data;
  if (text.toLowerCase().includes(SUMMARY_WORD)) {
    shutdown();
  } else {
    tail = text.length > WINDOW ? text.slice(-WINDOW) : text;
  }
});

piProc.onExit(() => {
  process.stdin.setRawMode?.(false);
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Forward stdin and resize events
// ---------------------------------------------------------------------------

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", (data) => {
  clearTimeout(userTypingTimer);
  userTypingTimer = setTimeout(() => {
    userTypingTimer = null;
    tail = ""; // discard any echoed chars that landed in the window
  }, 150);
  piProc.write(typeof data === "string" ? data : data.toString("binary"));
});

process.on("SIGWINCH", () => {
  piProc.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
});

// ---------------------------------------------------------------------------
// Signal forwarding
// ---------------------------------------------------------------------------

process.on("SIGINT", () => {
  // In raw mode, Ctrl-C is forwarded as a data byte (\x03) via stdin.on("data")
  // above, so we only need this as a fallback for non-TTY contexts.
  try {
    piProc.kill("SIGINT");
  } catch {
    // already gone
  }
});
