import { type Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { platform as osPlatform } from "node:os";
import { join } from "node:path";

export type BraintrustCliDiscovery = {
  readonly installed: boolean;
  readonly commandPath?: string;
  readonly version?: string;
};

export type BraintrustCliContext = {
  readonly profile?: string;
  readonly org?: string;
  readonly project?: string;
};

export type BraintrustCliUpdateCheck = {
  readonly upToDate: boolean;
};

export type BraintrustCliConfigureArgs = {
  readonly apiKey: string;
  readonly apiUrl: string;
  readonly appUrl: string;
  readonly orgName: string;
  readonly projectName: string;
};

export type BraintrustCliRuntime = {
  readonly discover: () => Promise<BraintrustCliDiscovery>;
  readonly install: () => Promise<void>;
  readonly checkForUpdate: (
    commandPath: string,
  ) => Promise<BraintrustCliUpdateCheck>;
  readonly update: (commandPath: string) => Promise<void>;
  readonly status: (commandPath: string) => Promise<BraintrustCliContext>;
  readonly loginAndSwitch: (
    commandPath: string,
    args: BraintrustCliConfigureArgs,
  ) => Promise<void>;
};

type CommandSpec = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
};

type CommandResult = {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

type BraintrustCliRuntimeDeps = {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly exec?: (spec: CommandSpec) => Promise<CommandResult>;
  readonly findCommand?: (command: string) => Promise<string | undefined>;
};

const BT_INSTALL_URL = "https://bt.dev/cli/install.sh";
const BT_WINDOWS_INSTALLER_URL =
  "https://github.com/braintrustdata/bt/releases/latest/download/bt-installer.ps1";

export function createBraintrustCliRuntime(
  deps: BraintrustCliRuntimeDeps = {},
): BraintrustCliRuntime {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? osPlatform();
  const exec = deps.exec ?? execCapture;
  const findCommand =
    deps.findCommand ??
    ((command) => findCommandOnPath(command, { env, exec, platform }));

  return {
    async discover() {
      const commandPath =
        (await findCommand("bt")) ??
        (await findKnownInstallPath(env, platform));
      if (!commandPath) return { installed: false };

      const versionResult = await exec({
        command: commandPath,
        args: ["--version"],
        env,
      });
      const version =
        versionResult.exitCode === 0
          ? firstNonEmptyLine(versionResult.stdout, versionResult.stderr)
          : undefined;

      return version
        ? { installed: true, commandPath, version }
        : { installed: true, commandPath };
    },

    async install() {
      const spec =
        platform === "win32"
          ? {
              command: "powershell",
              args: [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                `$ProgressPreference='SilentlyContinue'; irm ${BT_WINDOWS_INSTALLER_URL} | iex`,
              ],
              env,
            }
          : {
              command: "sh",
              args: ["-c", `curl -fsSL ${BT_INSTALL_URL} | bash -s -- --quiet`],
              env,
            };
      await execChecked("Braintrust CLI install", spec, exec);
    },

    async checkForUpdate(commandPath) {
      const result = await exec({
        command: commandPath,
        args: ["self", "update", "--check", "--json"],
        env,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `Braintrust CLI update check failed with exit code ${result.exitCode}. ${summarizeCommandOutput(result)}`.trim(),
        );
      }
      return parseUpdateCheckJson(result.stdout);
    },

    async update(commandPath) {
      await execChecked(
        "Braintrust CLI update",
        { command: commandPath, args: ["self", "update"], env },
        exec,
      );
    },

    async status(commandPath) {
      const result = await exec({
        command: commandPath,
        args: ["status", "--json"],
        env,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `Braintrust CLI status failed with exit code ${result.exitCode}. ${summarizeCommandOutput(result)}`.trim(),
        );
      }
      return parseStatusJson(result.stdout);
    },

    async loginAndSwitch(commandPath, args) {
      const childEnv = {
        ...env,
        BRAINTRUST_API_KEY: args.apiKey,
        BRAINTRUST_API_URL: args.apiUrl,
        BRAINTRUST_APP_URL: args.appUrl,
      };
      const profileName = args.orgName;

      await execChecked(
        "Braintrust CLI login",
        {
          command: commandPath,
          args: [
            "login",
            `--profile=${profileName}`,
            `--org=${args.orgName}`,
            "--no-input",
            "--quiet",
          ],
          env: childEnv,
        },
        exec,
      );
      await execChecked(
        "Braintrust CLI project switch",
        {
          command: commandPath,
          args: [
            "switch",
            `--profile=${profileName}`,
            `--org=${args.orgName}`,
            "--no-input",
            "--quiet",
            "--global",
            args.projectName,
          ],
          env: childEnv,
        },
        exec,
      );
    },
  };
}

export function summarizeBraintrustCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncate(redactSensitiveText(message), 500);
}

function execCapture(spec: CommandSpec): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, [...spec.args], {
      env: spec.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on("data", (chunk: Buffer) =>
      stdout.push(chunk.toString("utf8")),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      stderr.push(chunk.toString("utf8")),
    );
    child.on("error", (error) =>
      resolve({
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: error.message,
      }),
    );
    child.on("close", (code, signal) =>
      resolve({
        exitCode: code ?? 1,
        signal,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      }),
    );
  });
}

async function execChecked(
  action: string,
  spec: CommandSpec,
  exec: (spec: CommandSpec) => Promise<CommandResult>,
): Promise<void> {
  const result = await exec(spec);
  if (result.exitCode !== 0) {
    throw new Error(
      `${action} failed with exit code ${result.exitCode}. ${summarizeCommandOutput(result)}`.trim(),
    );
  }
}

async function findCommandOnPath(
  command: string,
  args: {
    readonly env: NodeJS.ProcessEnv;
    readonly exec: (spec: CommandSpec) => Promise<CommandResult>;
    readonly platform: NodeJS.Platform;
  },
): Promise<string | undefined> {
  const result =
    args.platform === "win32"
      ? await args.exec({ command: "where", args: [command], env: args.env })
      : await args.exec({
          command: "sh",
          args: ["-c", `command -v ${shellQuote(command)}`],
          env: args.env,
        });
  if (result.exitCode !== 0) return undefined;
  return firstNonEmptyLine(result.stdout);
}

async function findKnownInstallPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const binary = platform === "win32" ? "bt.exe" : "bt";
  const candidates = [
    env["XDG_BIN_HOME"] ? join(env["XDG_BIN_HOME"], binary) : undefined,
    env["XDG_DATA_HOME"]
      ? join(env["XDG_DATA_HOME"], "..", "bin", binary)
      : undefined,
    env["HOME"] ? join(env["HOME"], ".local", "bin", binary) : undefined,
    env["USERPROFILE"]
      ? join(env["USERPROFILE"], ".local", "bin", binary)
      : undefined,
  ].filter((value): value is string => value !== undefined);

  for (const candidate of candidates) {
    if (await executableExists(candidate)) return candidate;
  }
  return undefined;
}

async function executableExists(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

function parseUpdateCheckJson(stdout: string): BraintrustCliUpdateCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Braintrust CLI update check returned invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Braintrust CLI update check returned invalid JSON.");
  }
  const upToDate = (parsed as Record<string, unknown>)["up_to_date"];
  if (typeof upToDate !== "boolean") {
    throw new Error(
      "Braintrust CLI update check response was missing the `up_to_date` field.",
    );
  }
  return { upToDate };
}

function parseStatusJson(stdout: string): BraintrustCliContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Braintrust CLI status returned invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Braintrust CLI status returned invalid JSON.");
  }
  const obj = parsed as Record<string, unknown>;
  const profile = stringField(obj, "profile");
  const org = stringField(obj, "org");
  const project = stringField(obj, "project");

  return {
    ...(profile !== undefined ? { profile } : {}),
    ...(org !== undefined ? { org } : {}),
    ...(project !== undefined ? { project } : {}),
  };
}

function stringField(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function firstNonEmptyLine(...values: readonly string[]): string | undefined {
  for (const value of values) {
    const line = value
      .split(/\r?\n/)
      .find((candidate) => candidate.trim().length > 0);
    if (line) return line.trim();
  }
  return undefined;
}

function summarizeCommandOutput(result: CommandResult): string {
  return truncate(
    redactSensitiveText([result.stderr, result.stdout].join("\n").trim()),
    400,
  );
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/BRAINTRUST_API_KEY=\S+/g, "BRAINTRUST_API_KEY=[REDACTED]")
    .replace(/\b(?:sk|bt)[-_][A-Za-z0-9._~+/=-]{8,}\b/g, "[REDACTED]");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
