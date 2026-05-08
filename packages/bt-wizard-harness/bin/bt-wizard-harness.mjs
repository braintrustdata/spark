#!/usr/bin/env node
/**
 * Thin launcher for the bt-wizard pi harness.
 *
 * Usage: bt-wizard-harness --prompt-file <path> [extra pi args...]
 *
 * Runs pi in RPC mode (--mode rpc) so we can:
 *   - Stream assistant text transparently to stdout (text mode feel)
 *   - Detect "Summary" in the agent's text output and exit to Cleanup
 *   - Handle extension_ui_request from request-command-tool via the terminal
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

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// Resolve the `pi` binary from the workspace's node_modules, falling back to
// `pi` on PATH if not found (e.g. when installed globally).
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

const piArgs = [
  "--mode",
  "rpc",
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

const piProc = spawn(piBin, piArgs, {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: process.cwd(),
});

piProc.on("error", (err) => {
  process.stderr.write(`failed to spawn ${piBin}: ${err.message}\n`);
  process.exit(127);
});

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------

function send(obj) {
  piProc.stdin.write(JSON.stringify(obj) + "\n");
}

function respond(event, payload) {
  send({ type: "extension_ui_response", id: event.id, ...payload });
}

// Strip a trailing \r so both LF and CRLF line endings are handled.
function trimCr(s) {
  return s.endsWith("\r") ? s.slice(0, -1) : s;
}

// JSONL reader: split only on \n (per RPC spec — do NOT use readline which
// also splits on Unicode line separators U+2028/U+2029).
function attachJsonlReader(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = trimCr(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) onLine(line);
    }
  });
  stream.on("end", () => {
    const rest = trimCr(buffer + decoder.end());
    if (rest.length > 0) onLine(rest);
  });
}

// ---------------------------------------------------------------------------
// Async event queue — process pi RPC events sequentially in a while loop
// ---------------------------------------------------------------------------

const eventQueue = [];
let drainResolve = null;

function enqueue(event) {
  eventQueue.push(event);
  if (drainResolve) {
    const resolve = drainResolve;
    drainResolve = null;
    resolve();
  }
}

async function nextEvent() {
  if (eventQueue.length > 0) return eventQueue.shift();
  await new Promise((resolve) => {
    drainResolve = resolve;
  });
  return eventQueue.shift();
}

attachJsonlReader(piProc.stdout, (line) => {
  try {
    enqueue(JSON.parse(line));
  } catch {
    // pi may emit non-JSON startup lines before RPC mode is active
  }
});

piProc.on("close", (code) => {
  enqueue({ type: "_exit", code: code ?? 0 });
});

// ---------------------------------------------------------------------------
// Terminal I/O
// ---------------------------------------------------------------------------

function readLineFromTerminal(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function handleUiRequest(event) {
  switch (event.method) {
    case "notify":
      process.stdout.write(`\n[${event.notifyType ?? "info"}] ${event.message}\n`);
      return; // fire-and-forget, no response

    case "confirm": {
      process.stdout.write(`\n${event.title}\n${event.message ?? ""}\n`);
      const answer = await readLineFromTerminal("Allow? [y/N]: ");
      const confirmed = ["y", "yes"].includes(answer.trim().toLowerCase());
      respond(event, { confirmed });
      return;
    }

    case "select": {
      process.stdout.write(`\n${event.title}\n`);
      (event.options ?? []).forEach((opt, i) => {
        process.stdout.write(`  ${i + 1}) ${opt}\n`);
      });
      const answer = await readLineFromTerminal("Choice (number): ");
      const idx = parseInt(answer.trim(), 10) - 1;
      respond(event, { value: event.options?.[idx] ?? event.options?.[0] });
      return;
    }

    case "input": {
      const answer = await readLineFromTerminal(`${event.title}: `);
      respond(event, { value: answer });
      return;
    }

    default:
      respond(event, { cancelled: true });
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function extractAssistantText(message) {
  if (!message?.content) return "";
  const parts = Array.isArray(message.content)
    ? message.content
    : [{ type: "text", text: String(message.content) }];
  return parts
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

function hasSummary(text) {
  return text.toLowerCase().includes("summary");
}

let summaryDetected = false;

async function run() {
  send({ type: "prompt", message: "Begin the Braintrust SDK installation task." });

  while (true) {
    const event = await nextEvent();

    switch (event.type) {
      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (!ae) break;
        if (ae.type === "thinking_start") {
          process.stdout.write("\n[thinking] ");
        } else if (ae.type === "thinking_delta") {
          process.stdout.write(ae.delta);
        } else if (ae.type === "thinking_end") {
          process.stdout.write("\n");
        } else if (ae.type === "text_delta") {
          process.stdout.write(ae.delta);
        }
        break;
      }

      case "message_end": {
        const msg = event.message;
        if (msg?.role === "assistant") {
          if (hasSummary(extractAssistantText(msg))) summaryDetected = true;
        }
        break;
      }

      case "tool_execution_start":
        process.stdout.write(`\n[▶ ${event.toolName}]\n`);
        break;

      case "agent_end": {
        // Fallback check: message_end may not fire for every message in some
        // pi versions, so scan agent_end.messages if summary not yet detected.
        if (!summaryDetected) {
          for (const msg of event.messages ?? []) {
            if (msg.role === "assistant" && hasSummary(extractAssistantText(msg))) {
              summaryDetected = true;
              break;
            }
          }
        }

        if (summaryDetected) return;

        const userInput = await readLineFromTerminal("\n> ");
        if (userInput.trim()) {
          send({ type: "prompt", message: userInput });
        }
        break;
      }

      case "extension_ui_request":
        await handleUiRequest(event);
        break;

      case "_exit":
        return;
    }
  }
}

process.on("SIGINT", () => {
  send({ type: "abort" });
  setTimeout(() => {
    piProc.kill("SIGTERM");
    process.exit(0);
  }, 1000).unref();
});

run()
  .catch((err) => {
    process.stderr.write(`harness error: ${err.message}\n`);
  })
  .finally(() => {
    try {
      piProc.stdin.end();
    } catch {
      // already closed
    }
  });
