import {
  ACCOUNT_QUESTION,
  LOGIN_BROWSER_PROMPT,
  WIZARD_CANCEL_MESSAGE,
  WIZARD_SIGNIN_COMPLETE_MESSAGE,
  WIZARD_SIGNIN_LINK_TITLE,
  WIZARD_SIGNIN_RESULT_TITLE,
  WIZARD_TITLE,
  wizardSigninLinkNote,
  wizardSigninResultNote,
} from "./wizard-copy";
import { openUrl as defaultOpenUrl } from "./open-url";
import {
  createWizardSigninClient,
  loginUrlWithAuthMode,
  waitForWizardSigninCompletion,
  type CompletedWizardSigninResult,
  type WizardSigninClient,
  type WizardSigninOrgInfo,
  type WizardSigninProject,
} from "./wizard-signin-client";

type ConfirmOptions = {
  readonly initialValue?: boolean;
  readonly message: string;
};

type PromptLog = {
  readonly warn: (message: string) => void;
};

type PromptResult<T> = T | symbol;

type PromptSpinner = {
  readonly error: (message?: string) => void;
  readonly message: (message?: string) => void;
  readonly start: (message?: string) => void;
  readonly stop: (message?: string) => void;
};

export type ClackWizardPrompts = {
  readonly cancel: (message: string) => void;
  readonly confirm: (options: ConfirmOptions) => Promise<PromptResult<boolean>>;
  readonly intro: (message: string) => void;
  readonly isCancel: (value: unknown) => value is symbol;
  readonly log?: PromptLog;
  readonly note: (message?: string, title?: string) => void;
  readonly outro: (message: string) => void;
  readonly spinner: () => PromptSpinner;
};

export type ClackWizardResult = {
  readonly apiKey: string;
  readonly backendUrl: string;
  readonly hasBraintrustAccount: boolean;
  readonly openBrowser: boolean;
  readonly org: WizardSigninOrgInfo;
  readonly project: WizardSigninProject;
};

export type ClackWizardOptions = {
  readonly backendUrl?: string;
  readonly client?: WizardSigninClient;
  readonly env?: NodeJS.ProcessEnv;
  readonly openUrl?: (url: string) => Promise<void>;
  readonly pollIntervalMs?: number;
};

export class WizardCancelledError extends Error {
  constructor() {
    super(WIZARD_CANCEL_MESSAGE);
    this.name = "WizardCancelledError";
  }
}

async function confirmOrCancel(prompts: ClackWizardPrompts, message: string) {
  const value = await prompts.confirm({
    initialValue: true,
    message,
  });

  if (prompts.isCancel(value)) {
    prompts.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }

  return value;
}

export async function runClackWizard(
  prompts: ClackWizardPrompts,
  options: ClackWizardOptions = {},
): Promise<ClackWizardResult> {
  prompts.intro(WIZARD_TITLE);

  const hasBraintrustAccount = await confirmOrCancel(prompts, ACCOUNT_QUESTION);
  const openBrowser = await confirmOrCancel(prompts, LOGIN_BROWSER_PROMPT);
  const client = options.client ?? createClient(options);

  const session = await withSpinner({
    prompts,
    startMessage: "Creating Braintrust sign-in session...",
    stopMessage: "Created Braintrust sign-in session.",
    errorMessage: "Failed to create Braintrust sign-in session.",
    task: async () => await client.createSigninSession(),
  });
  const loginUrl = loginUrlWithAuthMode(
    session.loginUrl,
    hasBraintrustAccount ? "signin" : "signup",
  );

  prompts.note(
    wizardSigninLinkNote({
      expiresAt: session.expiresAt,
      loginUrl,
    }),
    WIZARD_SIGNIN_LINK_TITLE,
  );

  if (openBrowser) {
    try {
      await (options.openUrl ?? defaultOpenUrl)(loginUrl);
    } catch (error) {
      prompts.log?.warn(
        `Could not open the browser automatically. Open the sign-in link manually. ${errorMessage(
          error,
        )}`,
      );
    }
  }

  const result = await withSpinner({
    prompts,
    startMessage: "Waiting for browser sign-in to finish...",
    stopMessage: "Braintrust sign-in complete.",
    errorMessage: "Braintrust sign-in failed.",
    task: async (spinner) =>
      await waitForWizardSigninCompletion({
        client,
        onPollResult(pollResult) {
          if (pollResult.status === "pending") {
            spinner.message(
              `Waiting for browser sign-in to finish. Session expires at ${pollResult.expiresAt}.`,
            );
          }
        },
        session,
        ...(options.pollIntervalMs === undefined
          ? {}
          : { pollIntervalMs: options.pollIntervalMs }),
      }),
  });

  prompts.note(formatSigninResult(result), WIZARD_SIGNIN_RESULT_TITLE);
  prompts.outro(WIZARD_SIGNIN_COMPLETE_MESSAGE);

  return {
    apiKey: result.apiKey,
    backendUrl: client.backendUrl,
    hasBraintrustAccount,
    openBrowser,
    org: result.orgInfo,
    project: result.project,
  };
}

function createClient(options: ClackWizardOptions) {
  return createWizardSigninClient({
    ...(options.backendUrl === undefined
      ? {}
      : { backendUrl: options.backendUrl }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
}

async function withSpinner<T>({
  prompts,
  startMessage,
  stopMessage,
  errorMessage,
  task,
}: {
  readonly prompts: ClackWizardPrompts;
  readonly startMessage: string;
  readonly stopMessage: string;
  readonly errorMessage: string;
  readonly task: (spinner: PromptSpinner) => Promise<T>;
}) {
  const spinner = prompts.spinner();
  spinner.start(startMessage);

  try {
    const value = await task(spinner);
    spinner.stop(stopMessage);
    return value;
  } catch (error) {
    spinner.error(errorMessage);
    throw error;
  }
}

function formatSigninResult(result: CompletedWizardSigninResult) {
  return wizardSigninResultNote({
    apiKey: result.apiKey,
    orgId: result.orgInfo.id,
    orgName: result.orgInfo.name,
    projectId: result.project.id,
    projectName: result.project.name,
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
