import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DetectedLanguage } from "./language-detect";

const HARNESS_BIN_PATH = fileURLToPath(
  import.meta
    .resolve("@braintrust/bt-wizard-harness/bin/bt-wizard-harness.mjs"),
);

/**
 * Build the shell command a user can copy-paste to re-run the harness against
 * a saved prompt file.
 */
export function buildHarnessCommand(promptFilePath: string): string {
  return `node ${JSON.stringify(HARNESS_BIN_PATH)} --prompt-file ${JSON.stringify(promptFilePath)}`;
}

export type InstallBtResult =
  | { readonly status: "already-installed" }
  | { readonly status: "installed" }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string };

const BT_INSTALL_URL = "https://bt.dev/cli/install.sh";

export async function ensureBtOnPath(): Promise<InstallBtResult> {
  if (await commandExists("bt")) {
    return { status: "already-installed" };
  }
  const plat = platform();
  if (plat === "win32") {
    return {
      status: "skipped",
      reason: "Windows install of `bt` is not yet supported.",
    };
  }
  if (plat !== "darwin" && plat !== "linux") {
    return {
      status: "skipped",
      reason: `Automatic install of \`bt\` not supported on ${plat}.`,
    };
  }
  return runShellPipeInstall();
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const which = spawn("sh", ["-c", `command -v ${cmd}`], {
      stdio: "ignore",
    });
    which.on("error", () => resolve(false));
    which.on("close", (code) => resolve(code === 0));
  });
}

function runShellPipeInstall(): Promise<InstallBtResult> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", `curl -fsSL ${BT_INSTALL_URL} | bash`], {
      stdio: "inherit",
    });
    child.on("error", (err) =>
      resolve({ status: "failed", reason: err.message }),
    );
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ status: "installed" });
      } else {
        resolve({
          status: "failed",
          reason: `installer exited with code ${code}`,
        });
      }
    });
  });
}

export type WritePromptToTempResult = {
  readonly path: string;
};

export function writePromptToTemp(prompt: string): WritePromptToTempResult {
  const dir = mkdtempSync(join(tmpdir(), "bt-wizard-"));
  const path = join(dir, "instrument-prompt.md");
  writeFileSync(path, prompt);
  return { path };
}

export type RunHarnessResult = {
  readonly status: "completed";
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly tracePermalink: string | undefined;
  readonly promptFilePath: string;
};

/**
 * Allocate a fresh result-file path that the harness will write the trace
 * permalink to. The path is also injected into the agent prompt via
 * {@link renderPrompt}'s `resultFilePath` and exposed to the harness via
 * `BT_WIZARD_RESULT_FILE` (path-guard whitelists it).
 */
export function allocateResultFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "bt-wizard-"));
  return join(dir, "result.txt");
}

function readResultFile(path: string): string | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export async function runHarness(args: {
  readonly prompt: string;
  readonly cwd: string;
  readonly braintrustApiKey: string;
  readonly resultFilePath: string;
  readonly providerCredentials?: Readonly<Record<string, string>>;
  readonly languages?: readonly DetectedLanguage[];
}): Promise<RunHarnessResult> {
  const promptFile = writePromptToTemp(args.prompt).path;
  // Touch the result file so the agent knows the path is writable and so
  // a missing file vs. an empty file are distinguishable.
  writeFileSync(args.resultFilePath, "");
  return new Promise((resolve) => {
    const child = spawn(
      "node",
      [HARNESS_BIN_PATH, "--prompt-file", promptFile],
      {
        cwd: args.cwd,
        env: {
          ...process.env,
          BRAINTRUST_API_KEY: args.braintrustApiKey,
          BT_WIZARD_RESULT_FILE: args.resultFilePath,
          BT_WIZARD_LANGUAGES: (args.languages ?? []).join(","),
          ...args.providerCredentials,
        },
        stdio: "inherit",
      },
    );
    child.on("error", () =>
      resolve({
        status: "completed",
        exitCode: 1,
        signal: null,
        tracePermalink: readResultFile(args.resultFilePath),
        promptFilePath: promptFile,
      }),
    );
    child.on("close", (code, signal) =>
      resolve({
        status: "completed",
        exitCode: code ?? 1,
        signal,
        tracePermalink: readResultFile(args.resultFilePath),
        promptFilePath: promptFile,
      }),
    );
  });
}
