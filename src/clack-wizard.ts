import { cwd as processCwd } from "node:process";

import { DeviceFlowAuthClient } from "./auth";
import {
  BraintrustApiClient,
  buildApiKeyName,
  type DataPlane,
  type Org,
  type Project,
  userHandle,
} from "./braintrust-api";
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
  ORG_CREATE_DATA_PLANE_QUESTION,
  ORG_CREATE_NAME_QUESTION,
  ORG_SELECT_QUESTION,
  PROJECT_CREATE_NAME_QUESTION,
  PROJECT_SELECT_QUESTION,
  PROVIDER_KEY_QUESTION,
  PROVIDER_QUESTION,
  RUN_HARNESS_QUESTION,
  SELECT_OR_CREATE_PROJECT_QUESTION,
  SIGNIN_URL_FALLBACK,
  SIGNUP_URL_FALLBACK,
  WIZARD_CANCEL_MESSAGE,
  WIZARD_TITLE,
  deviceCodePrompt,
  gitignoreNote,
  promptSavedNote,
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
  readonly authClient: DeviceFlowAuthClient;
  readonly buildApi: (token: string) => BraintrustApiClient;
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

  const fallbackUrl = hasAccount ? SIGNIN_URL_FALLBACK : SIGNUP_URL_FALLBACK;
  // Open the signin/signup landing first; the device-flow URL also routes
  // through there, so this is purely a UX hint while we kick off device flow.
  await deps.openBrowser(fallbackUrl).catch(() => false);

  const tokenResp = await deps.authClient.login({
    onPrompt: (info) => {
      prompts.note(deviceCodePrompt(info), "Login");
    },
    onTryOpenBrowser: (url) => deps.openBrowser(url),
  });

  const api = deps.buildApi(tokenResp.access_token);

  const user = await api.currentUserAwaitingProvisioning();
  const handle = userHandle(user);

  const org = await selectOrCreateOrg(deps, api);
  const project = await selectOrCreateProject(deps, api, org);

  const existingNames = await api.listApiKeyNames(org.id);
  const apiKeyName = buildApiKeyName({
    userHandle: handle,
    existingNames,
  });
  const apiKey = await api.createApiKey({
    orgId: org.id,
    name: apiKeyName,
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
    const result = writeEnvBraintrust(gitRoot, apiKey.key);
    prompts.log.success(`Wrote ${result.envFilePath}`);
    prompts.log.info(
      gitignoreNote({
        added: result.addedToGitignore,
        alreadyCovered: result.alreadyCovered,
      }),
    );
  } else {
    prompts.log.info(
      `BRAINTRUST_API_KEY=${apiKey.key}\nNot in a git repo — set this in your environment manually.`,
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
        org: org.name,
        project: project.name,
        apiKey: apiKey.key,
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
    orgName: org.name,
    projectName: project.name,
    braintrustApiKey: apiKey.key,
  };
}

async function selectOrCreateOrg(
  deps: WizardDeps,
  api: BraintrustApiClient,
): Promise<Org> {
  const { prompts, options } = deps;
  const orgs = await api.listOrgs();

  if (options.orgName) {
    const match = orgs.find((o) => o.name === options.orgName);
    if (match) {
      prompts.log.info(`Using --org ${match.name}`);
      return match;
    }
    const available = orgs.map((o) => o.name).join(", ") || "(none)";
    throw new Error(
      `Org "${options.orgName}" not found. Available orgs: ${available}.`,
    );
  }

  if (orgs.length === 0) {
    return createOrgInteractive(deps, api);
  }
  if (orgs.length === 1) {
    const only = orgs[0]!;
    prompts.log.info(`Only one org available: ${only.name}`);
    return only;
  }
  return deps.fuzzy({
    message: ORG_SELECT_QUESTION,
    choices: orgs.map((o) => ({ value: o, name: o.name })),
  });
}

async function createOrgInteractive(
  deps: WizardDeps,
  api: BraintrustApiClient,
): Promise<Org> {
  const { prompts } = deps;
  const name = unwrap(
    prompts,
    await prompts.text({ message: ORG_CREATE_NAME_QUESTION }),
  );
  const dataPlane = unwrap(
    prompts,
    await prompts.select<DataPlane>({
      message: ORG_CREATE_DATA_PLANE_QUESTION,
      options: [
        { label: "United States", value: "us" },
        { label: "European Union", value: "eu" },
      ],
    }),
  );
  const created = await api.createOrg({ orgName: name, dataPlane });
  if (created.existed) {
    prompts.log.info(`Reusing existing org "${name}".`);
  } else {
    prompts.log.success(`Created org "${name}".`);
  }
  // Refetch full org object so we have api_url etc.
  const refreshed = await api.listOrgs();
  const match = refreshed.find((o) => o.id === created.id);
  if (!match) {
    throw new Error(
      `Created org ${created.id} but it isn't visible in /v1/organization`,
    );
  }
  return match;
}

async function selectOrCreateProject(
  deps: WizardDeps,
  api: BraintrustApiClient,
  org: Org,
): Promise<Project> {
  const { prompts, options } = deps;
  const projects = await api.listProjects(org.id);

  if (options.projectName) {
    const match = projects.find((p) => p.name === options.projectName);
    if (match) {
      prompts.log.info(`Using --project ${match.name}`);
      return match;
    }
    const available = projects.map((p) => p.name).join(", ") || "(none)";
    throw new Error(
      `Project "${options.projectName}" not found in org "${org.name}". Available projects: ${available}.`,
    );
  }

  if (projects.length === 0) {
    return createProjectInteractive(deps, api, org);
  }

  const action = unwrap(
    prompts,
    await prompts.select<"select" | "create">({
      message: SELECT_OR_CREATE_PROJECT_QUESTION,
      options: [
        { label: "Select existing project", value: "select" },
        { label: "Create a new project", value: "create" },
      ],
    }),
  );

  if (action === "create") {
    return createProjectInteractive(deps, api, org);
  }

  return deps.fuzzy({
    message: PROJECT_SELECT_QUESTION,
    choices: projects.map((p) => ({ value: p, name: p.name })),
  });
}

async function createProjectInteractive(
  deps: WizardDeps,
  api: BraintrustApiClient,
  org: Org,
): Promise<Project> {
  const { prompts } = deps;
  const name = unwrap(
    prompts,
    await prompts.text({ message: PROJECT_CREATE_NAME_QUESTION }),
  );
  const created = await api.createProject({ orgId: org.id, name });
  prompts.log.success(`Created project "${created.name}".`);
  return created;
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
  const authClient = new DeviceFlowAuthClient(args.options.appUrl);
  return {
    cwd,
    env,
    options: args.options,
    prompts: args.prompts,
    authClient,
    buildApi: (token) => new BraintrustApiClient(args.options.apiUrl, token),
    fuzzy: fuzzySelect,
    openBrowser,
  };
}

// Exported for permalink construction in callers that get a span back.
export { buildLogsPermalink };
