import { cwd as processCwd } from "node:process";

import { WizardSigninAuthClient } from "./auth";
import { openBrowser } from "./browser";
import { buildLogsPermalink, buildCleanupMessage } from "./cleanup";
import { findGitRoot, isGitRepo, writeEnvBraintrust } from "./git";
import type { WizardOptions } from "./options";
import { LLM_PROVIDERS, type LlmProvider } from "./providers";
import {
  DOCS_URL,
  NOT_GIT_REPO_WARNING,
  PROVIDER_KEY_QUESTION,
  PROVIDER_QUESTION,
  WIZARD_CANCEL_MESSAGE,
  WIZARD_TITLE,
  gitignoreNote,
  wizardLoginPrompt,
} from "./wizard-copy";
import type { CredentialField } from "./providers";

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

  const session = await deps.authClient.login({
    onLoginUrl: ({ loginUrl }) => {
      prompts.note(wizardLoginPrompt({ loginUrl }), "Login");
    },
    onTryOpenBrowser: (url) => deps.openBrowser(url),
  });

  const provider = await selectProvider(deps);
  const providerCredentials = provider.custom
    ? undefined
    : await collectCredentials(prompts, provider);

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

  prompts.outro(
    buildCleanupMessage({
      docsUrl: DOCS_URL,
      tracePermalink: undefined,
      resumeCommand: undefined,
    }),
  );

  return {
    orgName: session.orgInfo.name,
    projectName: session.project.name,
    braintrustApiKey: session.apiKey,
  };
}

async function collectCredentials(
  prompts: ClackWizardPrompts,
  provider: LlmProvider,
): Promise<Record<string, string> | undefined> {
  const fields: readonly CredentialField[] = provider.credentials ?? [
    { envVar: provider.envVar!, label: provider.label, secret: true },
  ];
  const result: Record<string, string> = {};
  for (const field of fields) {
    const raw = unwrap(
      prompts,
      field.secret !== false
        ? await prompts.password({ message: PROVIDER_KEY_QUESTION(field.label) })
        : await prompts.text({ message: PROVIDER_KEY_QUESTION(field.label) }),
    );
    if (raw.length > 0) {
      result[field.envVar] = raw;
    }
  }
  if (Object.keys(result).length === 0) {
    prompts.log.warn("No credentials entered; skipping instrumentation.");
    return undefined;
  }
  return result;
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
    openBrowser,
  };
}

// Exported for permalink construction in callers that get a span back.
export { buildLogsPermalink };
