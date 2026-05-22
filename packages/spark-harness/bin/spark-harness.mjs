#!/usr/bin/env node
/**
 * Thin launcher for the spark pi harness.
 *
 * Usage: spark-harness --prompt-file <path> [extra pi args...]
 *
 * Runs pi inside a PTY so it gets a real terminal: correct window size,
 * ANSI colours, cursor control, and automatic resize on SIGWINCH.
 * We intercept the PTY output to scan for the INSTRUMENTATION_COMPLETE /
 * INSTRUMENTATION_INCOMPLETE sentinels; when one is seen and the agent
 * stops emitting output, we kill pi and exit so the wizard can run its
 * cleanup phase.
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
      "Usage: spark-harness --prompt-file <path> [extra pi args...]\n",
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
// Under a SEA parent, `process.execPath` is the spark binary, so we re-exec it
// with the __pi sentinel instead of treating it as `node`. Outside a SEA we can
// invoke node directly; if the pi shim wasn't found at all we fall back to a
// global `pi` on PATH.
function resolveSpawn() {
  if (!piJs) return ["pi", []];
  if (process.env.SPARK_SEA_REEXEC === "1") {
    return [process.execPath, ["__pi", piJs]];
  }
  return [process.execPath, [piJs]];
}
const [spawnBin, spawnArgs] = resolveSpawn();

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
  "Begin the Braintrust SDK instrumentation.",
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
const SENTINEL_COMPLETE = "INSTRUMENTATION_COMPLETE";
const SENTINEL_INCOMPLETE = "INSTRUMENTATION_INCOMPLETE";
const WINDOW = SENTINEL_INCOMPLETE.length - 1; // longest sentinel

let tail = "";
let summaryDetected = false;
let shutdownTimer = null;
// While the user is typing, pause scanning so echoed keystrokes don't trigger
// shutdown. The timer is reset on every keystroke and expires 150 ms after the
// last one — well before any agent response could arrive.
let userTypingTimer = null;

function scheduleShutdown() {
  // (Re-)arm a timer: kill pi after 1 s of PTY silence, i.e. when the agent
  // has finished outputting and is waiting for the user to type.
  clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    try {
      piProc.kill("SIGTERM");
    } catch {
      // already gone
    }
  }, 1000);
}

piProc.onData((data) => {
  process.stdout.write(data);

  if (userTypingTimer) return;

  if (summaryDetected) {
    // Agent is still outputting after the summary word — keep pushing the
    // shutdown deadline until output goes quiet.
    scheduleShutdown();
    return;
  }

  const text = tail + data;
  if (text.includes(SENTINEL_COMPLETE) || text.includes(SENTINEL_INCOMPLETE)) {
    summaryDetected = true;
    scheduleShutdown();
  } else {
    tail = text.length > WINDOW ? text.slice(-WINDOW) : text;
  }
});

piProc.onExit(() => {
  process.stdin.setRawMode?.(false);
  process.exit(summaryDetected ? 0 : 130);
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
