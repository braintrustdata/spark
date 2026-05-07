import { cwd as processCwd } from "node:process";

import { WizardSigninAuthClient } from "./auth";
import { openBrowser } from "./browser";
import { buildLogsPermalink, buildCleanupMessage } from "./cleanup";
import { fuzzySelect } from "./fuzzy";
import { findGitRoot, isGitRepo, writeEnvBraintrust } from "./git";
import { detectLanguages } from "./language-detect";
import {
  allocateResultFile,
  ensureBtOnPath,
  runHarness,
  writePromptToTemp,
} from "./instrument";
import type { WizardOptions } from "./options";
import { renderPrompt } from "./prompt";
import { LLM_PROVIDERS, type LlmProvider } from "./providers";
import {
  ACCOUNT_QUESTION,
  DOCS_URL,
  NOT_GIT_REPO_WARNING,
  PROVIDER_KEY_QUESTION,
  PROVIDER_QUESTION,
  RUN_HARNESS_QUESTION,
  WIZARD_CANCEL_MESSAGE,
  WIZARD_TITLE,
  promptSavedNote,
  gitignoreNote,
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
  readonly authClient: WizardSigninAuthClient;
  readonly fuzzy: typeof fuzzySelect;
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

  if (!isGitRepo(deps.cwd)) {
    prompts.log.warn(NOT_GIT_REPO_WARNING);
  }

  const hasAccount = unwrap(
    prompts,
    await prompts.confirm({ initialValue: true, message: ACCOUNT_QUESTION }),
  );

  // Open the signin/signup landing first as a UX hint while we kick off the
  // wizard sign-in session; the real login URL is shown right after.
  const fallbackPath = hasAccount ? "/signin" : "/signup-wizard";
  await deps
    .openBrowser(`${deps.options.appUrl}${fallbackPath}`)
    .catch(() => false);

  const session = await deps.authClient.login({
    onLoginUrl: ({ loginUrl }) => {
      prompts.note(wizardLoginPrompt({ loginUrl }), "Login");
    },
    onTryOpenBrowser: (url) => deps.openBrowser(url),
  });

  const provider = await selectProvider(deps);
  const rawProviderKey = provider.custom
    ? undefined
    : unwrap(
        prompts,
        await prompts.password({
          message: PROVIDER_KEY_QUESTION(provider.label),
        }),
      );
  const providerKey =
    rawProviderKey !== undefined && rawProviderKey.length > 0
      ? rawProviderKey
      : undefined;
  if (rawProviderKey !== undefined && providerKey === undefined) {
    prompts.log.warn("No provider API key entered; skipping instrumentation.");
  }

  const gitRoot = findGitRoot(deps.cwd);
  if (gitRoot) {
    const result = writeEnvBraintrust(gitRoot, session.apiKey);
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

  const canInstrument = !provider.custom && providerKey !== undefined;

  let tracePermalink: string | undefined;
  if (canInstrument) {
    const runIt = unwrap(
      prompts,
      await prompts.confirm({
        initialValue: true,
        message: RUN_HARNESS_QUESTION,
      }),
    );
    if (runIt) {
      tracePermalink = await runInstrumentation(deps, {
        org: session.orgInfo.name,
        project: session.project.name,
        apiKey: session.apiKey,
      });
    } else {
      const path = writePromptToTemp(
        renderPrompt({
          languages: detectLanguages(deps.cwd),
          interactive: false,
        }),
      ).path;
      prompts.note(promptSavedNote(path), "Prompt saved");
    }
  } else {
    const path = writePromptToTemp(
      renderPrompt({
        languages: detectLanguages(deps.cwd),
        interactive: false,
      }),
    ).path;
    prompts.note(promptSavedNote(path), "Prompt saved");
  }

  prompts.outro(
    buildCleanupMessage({
      docsUrl: DOCS_URL,
      tracePermalink,
    }),
  );

  return {
    orgName: session.orgInfo.name,
    projectName: session.project.name,
    braintrustApiKey: session.apiKey,
  };
}

async function selectProvider(deps: WizardDeps): Promise<LlmProvider> {
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

async function runInstrumentation(
  deps: WizardDeps,
  args: {
    readonly org: string;
    readonly project: string;
    readonly apiKey: string;
  },
): Promise<string | undefined> {
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
    languages: detectLanguages(deps.cwd),
    interactive: true,
    resultFilePath,
  });
  const harnessResult = await runHarness({
    prompt: promptText,
    cwd: deps.cwd,
    braintrustApiKey: args.apiKey,
    resultFilePath,
  });

  if (harnessResult.status === "harness-not-found") {
    const path = writePromptToTemp(promptText).path;
    prompts.log.warn(
      `Harness not found. Wrote prompt to ${path}; run a coding agent against it manually.`,
    );
    return undefined;
  }
  if (harnessResult.exitCode !== 0) {
    prompts.log.warn(`Harness exited with code ${harnessResult.exitCode}.`);
  }
  return harnessResult.tracePermalink;
}

export type DefaultDepsArgs = {
  readonly options: WizardOptions;
  readonly prompts: ClackWizardPrompts;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
};

export function buildDefaultDeps(args: DefaultDepsArgs): WizardDeps {
  const cwd = args.cwd ?? processCwd();
  const env = args.env ?? process.env;
  const authClient = new WizardSigninAuthClient(args.options.appUrl);
  return {
    cwd,
    env,
    options: args.options,
    prompts: args.prompts,
    authClient,
    fuzzy: fuzzySelect,
    openBrowser,
  };
}

// Exported for permalink construction in callers that get a span back.
export { buildLogsPermalink };
