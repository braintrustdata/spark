/**
 * crank-telemetry — spawned by crank at startup as a detached background
 * process. Reads JSON-line updates from stdin (language, provider,
 * stop-reason), waits until stdin closes (crank exited) or 15 minutes,
 * then POSTs the payload once.
 */

import * as readline from "node:readline";

const TELEMETRY_URL =
  process.env["CRANK_TELEMETRY_URL"] ??
  "https://www.braintrust.dev/app/cli-telemetry";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;
const VERSION = "dev";

type Update = {
  language?: string;
  provider?: string;
  stopReason?: string;
};

const state = {
  start: Math.floor(Date.now() / 1_000),
  language: undefined as string | undefined,
  provider: undefined as string | undefined,
  stopReason: "SIGINT",
};

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  try {
    const update: Update = JSON.parse(line);
    if (update.language) state.language = update.language;
    if (update.provider) state.provider = update.provider;
    if (update.stopReason) state.stopReason = update.stopReason;
  } catch {
    // ignore malformed lines
  }
});

async function send(): Promise<void> {
  const payload: Record<string, unknown> = {
    start: state.start,
    end: Math.floor(Date.now() / 1_000),
    "stop-reason": state.stopReason,
  };
  if (state.language !== undefined) payload["language"] = state.language;
  if (state.provider !== undefined) payload["provider"] = state.provider;
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": `crank/${VERSION}`,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      await fetch(TELEMETRY_URL, { method: "POST", headers, body, signal: controller.signal });
      clearTimeout(timer);
      return;
    } catch {
      // retry once then give up
    }
  }
}

const timeout = setTimeout(() => {
  rl.close();
}, MAX_WAIT_MS);
timeout.unref();

rl.once("close", async () => {
  clearTimeout(timeout);
  await send();
  process.exit(0);
});
