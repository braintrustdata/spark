import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, platform } from "node:os";
import { join } from "node:path";
import { getAsset, isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import * as tar from "tar";

import type { DetectedLanguage } from "./language-detect";

function extractHarnessFromAsset(): string {
  const asset = Buffer.from(getAsset("harness.tgz"));
  const hash = createHash("sha256").update(asset).digest("hex").slice(0, 16);
  const cacheRoot = join(homedir(), ".cache", "spark");
  const cacheDir = join(cacheRoot, hash);
  const binPath = join(cacheDir, "spark-harness", "bin", "spark-harness.mjs");
  if (existsSync(binPath)) return binPath;

  mkdirSync(cacheRoot, { recursive: true });
  const staging = mkdtempSync(join(cacheRoot, `.tmp-${hash}-`));
  try {
    // Cross-platform replacement for `tar -xzf`: the `tar` package's sync
    // file-based extract works on Windows where no system `tar` is guaranteed.
    const tgzPath = join(staging, "harness.tgz");
    writeFileSync(tgzPath, asset);
    tar.x({ sync: true, file: tgzPath, cwd: staging, gzip: true });
    rmSync(tgzPath);
    try {
      renameSync(staging, cacheDir);
    } catch (err) {
      if (existsSync(binPath)) {
        rmSync(staging, { recursive: true, force: true });
        return binPath;
      }
      throw err;
    }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  return binPath;
}

export function resolveHarnessBinPath(): string {
  const override = process.env.BT_WIZARD_HARNESS_BIN;
  if (override) return override;
  if (isSea()) {
    return extractHarnessFromAsset();
  }
  return fileURLToPath(
    import.meta.resolve("@braintrust/spark-harness/bin/spark-harness.mjs"),
  );
}

/**
 * The SEA injected main can only `import` built-in modules — dynamic `import()`
 * of a file URL also hits that restriction. The documented escape hatch is
 * `createRequire`, which loads CJS only, so we drop a tiny CJS shim next to
 * the extracted harness whose only job is to dynamic-`import()` the .mjs
 * (which works because the shim is a real file on disk, not the injected main).
 */
export function resolveHarnessBootstrapPath(): string {
  const binPath = resolveHarnessBinPath();
  const bootstrapPath = binPath.replace(/\.mjs$/, ".bootstrap.cjs");
  if (existsSync(bootstrapPath)) return bootstrapPath;
  const contents =
    "const { pathToFileURL } = require('node:url');\n" +
    "const { join, dirname } = require('node:path');\n" +
    "const target = pathToFileURL(join(dirname(__filename), 'spark-harness.mjs')).href;\n" +
    "import(target).catch((err) => { console.error(err); process.exit(1); });\n";
  writeFileSync(bootstrapPath, contents);
  return bootstrapPath;
}

/**
 * Sentinel argv that the SEA main script dispatches on to launch the harness
 * instead of the wizard. See cli.ts.
 */
export const HARNESS_SENTINEL_ARG = "__harness";

/**
 * Sentinel argv that re-execs the SEA as `node <piJs> [args]`. The harness uses
 * this when running inside a SEA, where `process.execPath` is the spark binary
 * itself — invoking `[execPath, piJs]` directly would just re-run the wizard
 * instead of pi.
 */
export const PI_SENTINEL_ARG = "__pi";

/**
 * Env var that signals to the harness that the parent process is a SEA, so it
 * must launch pi via the {@link PI_SENTINEL_ARG} re-exec dance instead of
 * `node <piJs>`.
 */
export const SEA_REEXEC_ENV = "SPARK_SEA_REEXEC";

/**
 * Drops a tiny CJS shim next to an extracted ESM/CJS file whose only job is to
 * dynamic-`import()` it. Same trick as {@link resolveHarnessBootstrapPath}: the
 * SEA injected main can only `import` built-ins, but a real on-disk CJS file
 * loaded via `createRequire` can re-enter dynamic import normally.
 */
export function resolvePiBootstrapPath(piJs: string): string {
  const bootstrapPath =
    piJs.replace(/\.[cm]?js$/, "") + ".spark-pi.bootstrap.cjs";
  if (existsSync(bootstrapPath)) return bootstrapPath;
  const targetJson = JSON.stringify(piJs);
  const contents =
    "const { pathToFileURL } = require('node:url');\n" +
    `const target = pathToFileURL(${targetJson}).href;\n` +
    "import(target).catch((err) => { console.error(err); process.exit(1); });\n";
  writeFileSync(bootstrapPath, contents);
  return bootstrapPath;
}

const HARNESS_BIN_PATH = resolveHarnessBinPath();

type HarnessLauncher = {
  readonly command: string;
  readonly leadingArgs: readonly string[];
};

function harnessLauncher(): HarnessLauncher {
  // In a SEA, `node` may not exist on PATH — re-exec ourselves with the
  // sentinel and let cli.ts dispatch into the harness.
  if (isSea()) {
    return { command: process.execPath, leadingArgs: [HARNESS_SENTINEL_ARG] };
  }
  return { command: "node", leadingArgs: [HARNESS_BIN_PATH] };
}

/**
 * Build the shell command a user can copy-paste to re-run the harness against
 * a saved prompt file.
 */
export function buildHarnessCommand(promptFilePath: string): string {
  const { command, leadingArgs } = harnessLauncher();
  const parts = [command, ...leadingArgs, "--prompt-file", promptFilePath];
  return parts.map((p) => JSON.stringify(p)).join(" ");
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
  const dir = mkdtempSync(join(tmpdir(), "spark-"));
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
  const dir = mkdtempSync(join(tmpdir(), "spark-"));
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
    const { command, leadingArgs } = harnessLauncher();
    const child = spawn(
      command,
      [...leadingArgs, "--prompt-file", promptFile],
      {
        cwd: args.cwd,
        env: {
          ...process.env,
          BRAINTRUST_API_KEY: args.braintrustApiKey,
          BT_WIZARD_RESULT_FILE: args.resultFilePath,
          BT_WIZARD_LANGUAGES: (args.languages ?? []).join(","),
          ...(isSea() ? { [SEA_REEXEC_ENV]: "1" } : {}),
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
