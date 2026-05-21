import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd as processCwd } from "node:process";

import pc from "picocolors";

import {
  WizardSessionAuthClient,
  type WizardSessionCompleteResult,
} from "./auth";
import { BraintrustApiClient } from "./braintrust-api";
import { openBrowser } from "./browser";
import { buildLogsPermalink, buildCleanupMessage } from "./cleanup";
import { findGitRoot, isGitRepo, writeEnvBraintrust } from "./git";
import {
  allocateResultFile,
  buildHarnessCommand,
  ensureBtOnPath,
  runHarness,
  writePromptToTemp,
} from "./instrument";
import { detectLanguages, type DetectedLanguage } from "./language-detect";
import type { WizardOptions } from "./options";
import { renderPrompt } from "./prompt";
import {
  LLM_PROVIDERS,
  type LlmProvider,
  type CredentialField,
} from "./providers";
import {
  DOCS_URL,
  NOT_GIT_REPO_WARNING,
  PROVIDER_KEY_QUESTION,
  PROVIDER_QUESTION,
  RUN_HARNESS_QUESTION,
  WIZARD_CANCEL_MESSAGE,
  WIZARD_TITLE,
  gitignoreNote,
  promptSavedNote,
  wizardLoginPrompt,
} from "./wizard-copy";

type SelectOption<T> = {
  readonly label: string;
  readonly value: T;
  readonly hint?: string;
};

export type ClackWizardPrompts = {
  readonly cancel: (message: string) => void;
  readonly confirm: (options: {
    readonly initialValue?: boolean;
    readonly message: string;
  }) => Promise<boolean | symbol>;
  readonly intro: (message: string) => void;
  readonly isCancel: (value: unknown) => value is symbol;
  readonly note: (message: string, title?: string) => void;
  readonly outro: (message: string) => void;
  readonly password: (options: {
    readonly message: string;
  }) => Promise<string | symbol>;
  readonly select: <T>(options: {
    readonly message: string;
    readonly options: ReadonlyArray<SelectOption<T>>;
  }) => Promise<T | symbol>;
  readonly text: (options: {
    readonly message: string;
    readonly placeholder?: string;
  }) => Promise<string | symbol>;
  readonly log: {
    readonly warn: (message: string) => void;
    readonly info: (message: string) => void;
    readonly error: (message: string) => void;
    readonly success: (message: string) => void;
  };
};

export type WizardDeps = {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly options: WizardOptions;
  readonly prompts: ClackWizardPrompts;
  readonly authClient: WizardSessionAuthClient;
  readonly openBrowser: (url: string) => Promise<boolean>;
};

export class WizardCancelledError extends Error {
  constructor() {
    super(WIZARD_CANCEL_MESSAGE);
    this.name = "WizardCancelledError";
  }
}

function unwrap<T>(prompts: ClackWizardPrompts, value: T | symbol): T {
  if (prompts.isCancel(value)) {
    prompts.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }
  return value as T;
}

export type WizardResult = {
  readonly orgName: string;
  readonly projectName: string;
  readonly braintrustApiKey: string;
};

export async function runClackWizard(deps: WizardDeps): Promise<WizardResult> {
  const { prompts } = deps;
  prompts.intro(WIZARD_TITLE);

  if (!(await isGitRepo(deps.cwd))) {
    prompts.log.warn(NOT_GIT_REPO_WARNING);
  }

  const session =
    deps.options.apiKey !== undefined && deps.options.projectId !== undefined
      ? await loginWithCiCredentials({
          apiKey: deps.options.apiKey,
          projectId: deps.options.projectId,
          apiUrl: deps.options.apiUrl,
        })
      : await deps.authClient.login({
          onLoginUrl: ({ loginUrl }) => {
            prompts.note(wizardLoginPrompt({ loginUrl }), "Login");
          },
          onTryOpenBrowser: (url) => deps.openBrowser(url),
        });

  prompts.log.success(
    `Browser setup complete.\n  org: ${pc.greenBright(session.orgName)}\n  project: ${pc.greenBright(session.projectName)}`,
  );

  const provider = await selectProvider(deps);
  let providerCredentials: Record<string, string> | undefined;
  if (!provider.custom) {
    if (
      deps.options.providerApiKey !== undefined &&
      provider.envVar !== undefined &&
      deps.options.provider?.id === provider.id
    ) {
      providerCredentials = { [provider.envVar]: deps.options.providerApiKey };
    } else {
      providerCredentials = await collectCredentials(prompts, provider);
    }
  }

  const gitRoot = await findGitRoot(deps.cwd);
  if (gitRoot) {
    const result = await writeEnvBraintrust(gitRoot, session.apiKey);
    prompts.log.success(`Wrote ${result.envFilePath}`);
    prompts.log.info(
      gitignoreNote({
        added: result.addedToGitignore,
        alreadyCovered: result.alreadyCovered,
      }),
    );
  } else {
    prompts.log.info(
      `BRAINTRUST_API_KEY=${session.apiKey}\nNot in a git repo — set this in your environment manually.`,
    );
  }

  const canInstrument = !provider.custom && providerCredentials !== undefined;
  const languages = detectLanguages(deps.cwd);

  let tracePermalink: string | undefined;
  let resumeCommand: string | undefined;
  if (canInstrument) {
    const runIt = deps.options.instrument
      ? true
      : unwrap(
          prompts,
          await prompts.confirm({
            initialValue: true,
            message: RUN_HARNESS_QUESTION,
          }),
        );
    if (runIt) {
      const result = await runInstrumentation(deps, {
        org: session.orgName,
        project: session.projectName,
        apiKey: session.apiKey,
        providerCredentials,
        languages,
      });
      tracePermalink = result.tracePermalink;
      resumeCommand = result.resumeCommand;
    } else {
      const { path } = writePromptToTemp(
        renderPrompt({ languages, interactive: false }),
      );
      prompts.note(promptSavedNote(path), "Prompt saved");
    }
  } else {
    const { path } = writePromptToTemp(
      renderPrompt({ languages, interactive: false }),
    );
    prompts.note(promptSavedNote(path), "Prompt saved");
  }

  prompts.outro(
    buildCleanupMessage({
      docsUrl: DOCS_URL,
      tracePermalink,
      resumeCommand,
    }),
  );

  return {
    orgName: session.orgName,
    projectName: session.projectName,
    braintrustApiKey: session.apiKey,
  };
}

// Pi stores per-provider credentials in `auth.json` and consults it BEFORE
// env vars (see pi's auth-storage docs: priority is auth.json > env). If the
// user already ran `/login` inside pi, prompting again and passing the new
// key via env would be silently overridden. So: if pi already has creds for
// the chosen provider, skip the prompt entirely.
// Spark provider id → pi auth.json key. Only entries that differ from the
// spark id need to be listed; everything else falls through to provider.id.
const PI_AUTH_KEY_BY_PROVIDER_ID: Readonly<Record<string, string>> = {
  gemini: "google",
  bedrock: "amazon-bedrock",
  azure: "azure-openai-responses",
};

function piAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env && env.length > 0) {
    if (env === "~") return homedir();
    if (env.startsWith("~/")) return homedir() + env.slice(1);
    return env;
  }
  return join(homedir(), ".pi", "agent");
}

function piAuthHasProvider(
  prompts: ClackWizardPrompts,
  providerId: string,
): boolean {
  const piKey = PI_AUTH_KEY_BY_PROVIDER_ID[providerId] ?? providerId;
  const authPath = join(piAgentDir(), "auth.json");
  let raw: string;
  try {
    raw = readFileSync(authPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      prompts.log.warn(
        `Could not read ${authPath}: ${(err as Error).message}. Will prompt for credentials.`,
      );
    }
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(parsed, piKey);
  } catch (err) {
    prompts.log.warn(
      `Could not parse ${authPath} (${(err as Error).message}). Pi may override any key entered here; fix or remove the file before continuing.`,
    );
    return false;
  }
}

async function collectCredentials(
  prompts: ClackWizardPrompts,
  provider: LlmProvider,
): Promise<Record<string, string> | undefined> {
  if (piAuthHasProvider(prompts, provider.id)) {
    prompts.log.info(
      `Using ${provider.label} credentials already stored in pi's auth.json.`,
    );
    return {};
  }
  const fields: readonly CredentialField[] = provider.credentials ?? [
    { envVar: provider.envVar!, label: provider.label, secret: true },
  ];
  const result: Record<string, string> = {};
  let satisfiedFromEnv = false;
  for (const field of fields) {
    const existing = process.env[field.envVar];
    if (existing !== undefined && existing.length > 0) {
      prompts.log.info(
        `Using ${field.envVar} from environment for ${field.label}.`,
      );
      satisfiedFromEnv = true;
      continue;
    }
    const raw = unwrap(
      prompts,
      field.secret !== false
        ? await prompts.password({
            message: PROVIDER_KEY_QUESTION(field.label),
          })
        : await prompts.text({ message: PROVIDER_KEY_QUESTION(field.label) }),
    );
    const value = raw ?? "";
    if (value.length > 0) {
      result[field.envVar] = value;
    }
  }
  if (Object.keys(result).length === 0 && !satisfiedFromEnv) {
    prompts.log.warn("No credentials entered; skipping instrumentation.");
    return undefined;
  }
  return result;
}

async function selectProvider(deps: WizardDeps): Promise<LlmProvider> {
  if (deps.options.provider) {
    return deps.options.provider;
  }
  const { prompts } = deps;
  const value = unwrap(
    prompts,
    await prompts.select<LlmProvider>({
      message: PROVIDER_QUESTION,
      options: LLM_PROVIDERS.map((p) => ({ label: p.label, value: p })),
    }),
  );
  return value;
}

type InstrumentationResult = {
  readonly tracePermalink: string | undefined;
  readonly resumeCommand: string | undefined;
};

async function runInstrumentation(
  deps: WizardDeps,
  args: {
    readonly org: string;
    readonly project: string;
    readonly apiKey: string;
    readonly providerCredentials?: Readonly<Record<string, string>>;
    readonly languages: readonly DetectedLanguage[];
  },
): Promise<InstrumentationResult> {
  const { prompts } = deps;
  const installResult = await ensureBtOnPath();
  switch (installResult.status) {
    case "already-installed":
      break;
    case "installed":
      prompts.log.success("Installed `bt`.");
      break;
    case "skipped":
      prompts.log.warn(`Skipping \`bt\` install: ${installResult.reason}`);
      break;
    case "failed":
      prompts.log.error(`Couldn't install \`bt\`: ${installResult.reason}`);
      break;
  }

  const resultFilePath = allocateResultFile();
  const promptText = renderPrompt({
    languages: args.languages,
    interactive: !deps.options.yolo,
    yolo: deps.options.yolo,
    resultFilePath,
  });
  const harnessResult = await runHarness({
    prompt: promptText,
    cwd: deps.cwd,
    braintrustApiKey: args.apiKey,
    resultFilePath,
    providerCredentials: args.providerCredentials,
    languages: args.languages,
  });

  if (harnessResult.status === "harness-not-found") {
    const { path } = writePromptToTemp(promptText);
    prompts.log.warn(
      `Harness not found. Wrote prompt to ${path}; run a coding agent against it manually.`,
    );
    return { tracePermalink: undefined, resumeCommand: undefined };
  }
  if (harnessResult.exitCode !== 0) {
    prompts.log.warn(`Harness exited with code ${harnessResult.exitCode}.`);
  }
  return {
    tracePermalink: harnessResult.tracePermalink,
    resumeCommand: buildHarnessCommand(harnessResult.promptFilePath),
  };
}

export type DefaultDepsArgs = {
  readonly options: WizardOptions;
  readonly prompts: ClackWizardPrompts;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
};

async function loginWithCiCredentials(args: {
  readonly apiKey: string;
  readonly projectId: string;
  readonly apiUrl: string;
}): Promise<WizardSessionCompleteResult> {
  const api = new BraintrustApiClient(args.apiUrl, args.apiKey);
  const project = await api.getProject(args.projectId);
  const org = await api.getOrg(project.org_id);
  return {
    apiKey: args.apiKey,
    orgId: org.id,
    orgName: org.name,
    projectId: project.id,
    projectName: project.name,
  };
}

export function buildDefaultDeps(args: DefaultDepsArgs): WizardDeps {
  const cwd = args.cwd ?? processCwd();
  const env = args.env ?? process.env;
  const authClient = new WizardSessionAuthClient(args.options.appUrl);
  return {
    cwd,
    env,
    options: args.options,
    prompts: args.prompts,
    authClient,
    openBrowser,
  };
}

// Exported for permalink construction in callers that get a span back.
export { buildLogsPermalink };
