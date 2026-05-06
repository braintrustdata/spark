import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

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
    const child = spawn("sh", ["-c", `curl -fsSL ${BT_INSTALL_URL} | sh`], {
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

export type RunHarnessResult =
  | {
      readonly status: "completed";
      readonly exitCode: number;
      readonly tracePermalink: string | undefined;
    }
  | {
      readonly status: "harness-not-found";
      readonly checked: readonly string[];
    };

const HARNESS_PATH_CANDIDATES: readonly string[] = [
  "/workspace/pi-mono-braintrust/packages/bt-wizard-harness/bin/bt-wizard-harness.mjs",
  "/workspace/pi-mono-braintrust/packages/bt-wizard-harness/bin/bt-wizard-harness",
];

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
}): Promise<RunHarnessResult> {
  const promptFile = writePromptToTemp(args.prompt).path;
  // Touch the result file so the agent knows the path is writable and so
  // a missing file vs. an empty file are distinguishable.
  writeFileSync(args.resultFilePath, "");
  const checked: string[] = [];
  for (const candidate of HARNESS_PATH_CANDIDATES) {
    checked.push(candidate);
    if (existsSync(candidate)) {
      return new Promise((resolve) => {
        const child = spawn("node", [candidate, "--prompt-file", promptFile], {
          cwd: args.cwd,
          env: {
            ...process.env,
            BRAINTRUST_API_KEY: args.braintrustApiKey,
            BT_WIZARD_RESULT_FILE: args.resultFilePath,
          },
          stdio: "inherit",
        });
        child.on("error", () =>
          resolve({
            status: "completed",
            exitCode: 1,
            tracePermalink: readResultFile(args.resultFilePath),
          }),
        );
        child.on("close", (code) =>
          resolve({
            status: "completed",
            exitCode: code ?? 0,
            tracePermalink: readResultFile(args.resultFilePath),
          }),
        );
      });
    }
  }
  return { status: "harness-not-found", checked };
}
