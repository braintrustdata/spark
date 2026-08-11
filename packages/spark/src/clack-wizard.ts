import { cwd as processCwd } from "node:process";
import { relative } from "node:path";

import * as clack from "@clack/prompts";
import clipboard from "clipboardy";
import pc from "picocolors";

import {
  createWizardSession,
  loginWithWizardSession as loginWithWizardSessionRequest,
  WizardSessionLoginError,
  type WizardSessionCompleteResult,
  type WizardSessionCreateResponse,
  type WizardSessionLoginUrlParams,
  type WizardSessionLogin,
} from "./auth";
import { BraintrustApiClient } from "./braintrust-api";
import {
  createBraintrustCliRuntime,
  summarizeBraintrustCliError,
  type BraintrustCliContext,
  type BraintrustCliRuntime,
} from "./braintrust-cli";
import { openBrowser } from "./browser";
import { CLACK_WIZARD_COPY } from "./clack-copy";
import { buildLogsPermalink } from "./cleanup";
import {
  codingToolLabel,
  discoverCodingTools,
  runCodingTool,
  smokeTestCodingTool,
  type CodingToolId,
  type CodingToolEvent,
  type CodingToolRunResult,
  type CodingToolStatus,
} from "./coding-tools";
import {
  getUncommittedOrUntrackedFiles,
  isGitRepo,
  writeEnvBraintrust,
} from "./git";
import { allocateResultFile, readResultFile } from "./instrument";
import { DEFAULT_APP_URL, type WizardOptions } from "./options";
import { renderPrompt } from "./prompt";
import { ClackToolRenderer } from "./tool-ui";
import {
  buildCliSetupClientContext,
  createWizardEvents,
  type CliSetupCodingToolResult,
  type CliSetupFailureCategory,
  type CliSetupReasonCode,
  type WizardEventStep,
  type WizardEventsRuntime,
} from "./events";

const COPY = CLACK_WIZARD_COPY;
const WIZARD_CANCEL_MESSAGE = COPY.shared.cancelMessage;

type BuiltInInstrumentationChoice = {
  readonly id: "built-in";
  readonly label: typeof COPY.instrumentation.modes.builtIn.label;
};

type OwnAgentInstrumentationChoice = {
  readonly id: "own-agent";
  readonly label: typeof COPY.instrumentation.modes.ownAgent.label;
};

type ManualInstrumentationChoice = {
  readonly id: "manual";
  readonly label: typeof COPY.instrumentation.modes.manual.label;
};

type InstrumentationModeChoice =
  | BuiltInInstrumentationChoice
  | OwnAgentInstrumentationChoice
  | ManualInstrumentationChoice;

type OwnAgentPromptDelivery = "clipboard" | "terminal";

type BraintrustCliBackgroundTask = {
  readonly wait: (spinner: WizardStepSpinner) => Promise<
    | { readonly outcome: "completed" }
    | {
        readonly outcome: "failed";
        readonly reasonCode: "bt_cli_status_failed";
      }
  >;
};

type BraintrustCliSetupResult =
  | {
      readonly outcome: "skipped" | "failed";
      readonly reasonCode:
        | "bt_cli_install_declined"
        | "bt_cli_context_switch_declined"
        | "bt_cli_install_failed"
        | "bt_cli_status_failed";
    }
  | {
      readonly outcome: "pending";
      readonly backgroundTask: BraintrustCliBackgroundTask;
    };

function createBraintrustCliBackgroundTask(
  task: Promise<unknown>,
): BraintrustCliBackgroundTask {
  const result = task.then(
    () => undefined,
    (error: unknown) => error,
  );

  return {
    wait: async (waitSpinner) => {
      const error = await result;
      if (error !== undefined) {
        waitSpinner.clear();
        clack.log.warn(
          COPY.braintrustCli.configureFailed(
            summarizeBraintrustCliError(error),
          ),
        );
        return {
          outcome: "failed" as const,
          reasonCode: "bt_cli_status_failed" as const,
        };
      }
      return { outcome: "completed" as const };
    },
  };
}

const BUILT_IN_INSTRUMENTATION_CHOICE: BuiltInInstrumentationChoice = {
  id: "built-in",
  label: COPY.instrumentation.modes.builtIn.label,
};

const OWN_AGENT_INSTRUMENTATION_CHOICE: OwnAgentInstrumentationChoice = {
  id: "own-agent",
  label: COPY.instrumentation.modes.ownAgent.label,
};

const MANUAL_INSTRUMENTATION_CHOICE: ManualInstrumentationChoice = {
  id: "manual",
  label: COPY.instrumentation.modes.manual.label,
};

class WizardStepSpinner {
  private spinner: ReturnType<typeof clack.spinner> | undefined;
  private active = false;

  update(message: string): void {
    if (this.active) {
      this.spinner!.message(message);
      return;
    }

    this.spinner ??= clack.spinner();
    this.spinner.start(message);
    this.active = true;
  }

  clear(): void {
    if (!this.active) return;

    this.spinner!.clear();
    this.active = false;
  }
}

type BooleanSelectChoices = {
  readonly yes: {
    readonly label: string;
    readonly hint?: string | undefined;
  };
  readonly no: {
    readonly label: string;
    readonly hint?: string | undefined;
  };
};

export type WizardDeps = {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly options: WizardOptions;
  readonly loginWithWizardSession: WizardSessionLogin;
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly braintrustCli: BraintrustCliRuntime;
  readonly codingTools: CodingToolRuntime;
  readonly setupEvents: WizardEventsRuntime;
};

export type CodingToolRuntime = {
  readonly discover: () => Promise<readonly CodingToolStatus[]>;
  readonly smokeTest: (args: {
    readonly id: CodingToolId;
    readonly cwd: string;
  }) => Promise<CodingToolRunResult>;
  readonly run: (args: {
    readonly id: CodingToolId;
    readonly cwd: string;
    readonly prompt: string;
    readonly env: NodeJS.ProcessEnv;
    readonly onEvent: (event: CodingToolEvent) => void;
  }) => Promise<CodingToolRunResult>;
};

export class WizardCancelledError extends Error {
  constructor(
    readonly failureCategory: CliSetupFailureCategory = "cancelled",
    readonly reasonCode: CliSetupReasonCode = "user_interrupt",
  ) {
    super(WIZARD_CANCEL_MESSAGE);
    this.name = "WizardCancelledError";
  }
}

class WizardFailedError extends Error {
  constructor(
    message: string,
    readonly failureCategory: CliSetupFailureCategory,
    readonly reasonCode: CliSetupReasonCode,
  ) {
    super(message);
    this.name = "WizardFailedError";
  }
}

function unwrap<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }
  return value;
}

async function selectBoolean(args: {
  readonly message: string;
  readonly choices: BooleanSelectChoices;
  readonly yesFirst: boolean;
}): Promise<boolean> {
  const yesOption = {
    label: args.choices.yes.label,
    value: true as const,
    ...(args.choices.yes.hint === undefined
      ? {}
      : { hint: args.choices.yes.hint }),
  };
  const noOption = {
    label: args.choices.no.label,
    value: false as const,
    ...(args.choices.no.hint === undefined
      ? {}
      : { hint: args.choices.no.hint }),
  };
  return unwrap(
    await clack.select<boolean>({
      message: args.message,
      options: args.yesFirst ? [yesOption, noOption] : [noOption, yesOption],
    }),
  );
}

async function confirmRepositoryContinuation(args: {
  readonly events: WizardEventsRuntime;
  readonly step: WizardEventStep;
  readonly state: "dirty" | "not_git";
  readonly message: string;
  readonly choices: BooleanSelectChoices;
  readonly declinedReason:
    | "repository_dirty_declined"
    | "repository_not_git_declined";
}): Promise<void> {
  let shouldContinue: boolean;
  try {
    shouldContinue = await selectBoolean({
      message: args.message,
      choices: args.choices,
      yesFirst: false,
    });
  } catch (error) {
    args.events.finishStep(args.step, "cancelled", {
      failureCategory: "cancelled",
      reasonCode: "user_interrupt",
      repositoryState: args.state,
      repositoryDecision: "cancel",
    });
    throw error;
  }

  if (!shouldContinue) {
    args.events.finishStep(args.step, "cancelled", {
      failureCategory: "repository_state",
      reasonCode: args.declinedReason,
      repositoryState: args.state,
      repositoryDecision: "cancel",
    });
    clack.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError("repository_state", args.declinedReason);
  }

  args.events.finishStep(args.step, "completed", {
    repositoryState: args.state,
    repositoryDecision: "continue",
  });
}

export type WizardResult = {
  readonly orgName: string;
  readonly projectName: string;
  readonly braintrustApiKey: string;
};

export async function runClackWizard(deps: WizardDeps): Promise<WizardResult> {
  process.stdout.write("\n");
  clack.intro(COPY.welcome.intro);

  const events = deps.setupEvents;
  const wizardSession = events.start();
  try {
    const result = await runClackWizardFlow(deps, events, wizardSession);
    await events.terminate({ outcome: "completed" });
    return result;
  } catch (error) {
    const cancelled = error instanceof WizardCancelledError;
    const categorizedFailure = error instanceof WizardFailedError;
    await events.terminate({
      outcome: cancelled ? "cancelled" : "failed",
      ...(cancelled || categorizedFailure
        ? { failureCategory: error.failureCategory }
        : {}),
      ...(cancelled || categorizedFailure
        ? { reasonCode: error.reasonCode }
        : { reasonCode: "unknown" as const }),
    });
    throw error;
  }
}

async function runClackWizardFlow(
  deps: WizardDeps,
  events: WizardEventsRuntime,
  wizardSession: Promise<WizardSessionCreateResponse | undefined>,
): Promise<WizardResult> {
  const repositoryStep = events.startStep("repository_preflight", {
    failureCategory: "repository_state",
  });
  const inGitRepo = await isGitRepo(deps.cwd);
  if (!inGitRepo) {
    await confirmRepositoryContinuation({
      events,
      step: repositoryStep,
      state: "not_git",
      message: COPY.gitRepository.outsideRepoWarning,
      choices: COPY.gitRepository.continueOutsideRepoChoices,
      declinedReason: "repository_not_git_declined",
    });
  } else {
    const dirtyFiles = await getUncommittedOrUntrackedFiles(deps.cwd);
    if (dirtyFiles.length > 0) {
      await confirmRepositoryContinuation({
        events,
        step: repositoryStep,
        state: "dirty",
        message: COPY.gitRepository.dirtyRepoWarning(dirtyFiles),
        choices: COPY.gitRepository.continueWithDirtyRepoChoices,
        declinedReason: "repository_dirty_declined",
      });
    } else {
      events.finishStep(repositoryStep, "completed", {
        repositoryState: "clean",
        repositoryDecision: "not_required",
      });
    }
  }
  const authenticationStep = events.startStep("authentication", {
    failureCategory: "auth",
  });
  let session: WizardSessionCompleteResult;
  try {
    if (
      deps.options.apiKey !== undefined &&
      deps.options.projectId !== undefined
    ) {
      events.setAuthMode("ci");
      session = await loginWithCiCredentials({
        apiKey: deps.options.apiKey,
        projectId: deps.options.projectId,
        apiUrl: deps.options.apiUrl,
      });
    } else {
      let authMode: WizardSessionLoginUrlParams["authMode"];
      if (
        deps.options.orgId !== undefined &&
        deps.options.projId !== undefined
      ) {
        authMode = "signin";
      } else {
        authMode = (await hasBraintrustAccount()) ? "signin" : "signup";
      }
      events.setAuthMode(authMode);
      session = await loginWithBrowser(deps, {
        authMode,
        wizardSession: await wizardSession,
      });
    }
  } catch (error) {
    if (error instanceof WizardCancelledError) throw error;
    const reasonCode =
      error instanceof WizardSessionLoginError
        ? error.reasonCode
        : "browser_auth_failed";
    events.finishStep(authenticationStep, "failed", {
      failureCategory: "auth",
      reasonCode,
    });
    throw new WizardFailedError(
      error instanceof Error ? error.message : String(error),
      "auth",
      reasonCode,
    );
  }
  events.finishStep(authenticationStep, "completed");

  const credentialsStep = events.startStep("credentials_write", {
    failureCategory: "filesystem",
  });
  try {
    await writeLocalEnvBraintrust(deps, session.apiKey);
  } catch (error) {
    events.finishStep(credentialsStep, "failed", {
      failureCategory: "filesystem",
      reasonCode: "credentials_write_failed",
    });
    throw new WizardFailedError(
      error instanceof Error ? error.message : String(error),
      "filesystem",
      "credentials_write_failed",
    );
  }
  events.finishStep(credentialsStep, "completed");

  const setupSpinner = new WizardStepSpinner();
  let codingToolStatuses: readonly CodingToolStatus[];
  const braintrustCliStep = events.startStep("bt_cli_setup", {
    failureCategory: "bt_cli",
  });
  let braintrustCliSetup: BraintrustCliSetupResult;
  try {
    braintrustCliSetup = await handleBraintrustCliSetup(
      deps,
      session,
      setupSpinner,
    );
    if (braintrustCliSetup.outcome !== "pending") {
      events.finishStep(braintrustCliStep, braintrustCliSetup.outcome, {
        ...(braintrustCliSetup.outcome === "failed"
          ? { failureCategory: "bt_cli" as const }
          : {}),
        reasonCode: braintrustCliSetup.reasonCode,
      });
    }
    const codingToolPreflightStep = events.startStep("coding_tool_preflight", {
      failureCategory: "coding_tool_unavailable",
    });
    codingToolStatuses = await preflightCodingTools(deps, setupSpinner);
    const hasUsableCodingTool = codingToolStatuses.some(
      (status) => status.usable,
    );
    const codingToolResults = codingToolStatuses.map((status) => {
      const result: CliSetupCodingToolResult = {
        toolId: status.id,
        detected: status.installed,
        usable: status.usable,
      };
      if (status.unavailableReasonCode === undefined) return result;
      return {
        ...result,
        unavailableReasonCode: status.unavailableReasonCode,
      };
    });
    if (hasUsableCodingTool) {
      events.finishStep(codingToolPreflightStep, "completed", {
        codingToolResults,
      });
    } else {
      events.finishStep(codingToolPreflightStep, "failed", {
        failureCategory: "coding_tool_unavailable",
        reasonCode: "no_usable_coding_tool",
        codingToolResults,
      });
    }
  } finally {
    setupSpinner.clear();
  }
  const hasUsableCodingTool = codingToolStatuses.some(
    (status) => status.usable,
  );
  if (!hasUsableCodingTool) {
    warnNoUsableCodingTools(codingToolStatuses);
  }

  let instrumentationMode: InstrumentationModeChoice | undefined =
    await selectAndTrackInstrumentationMode(events, {
      includeBuiltIn: hasUsableCodingTool,
    });
  if (braintrustCliSetup.outcome === "pending") {
    const result = await braintrustCliSetup.backgroundTask.wait(setupSpinner);
    events.finishStep(braintrustCliStep, result.outcome, {
      ...(result.outcome === "failed"
        ? {
            failureCategory: "bt_cli" as const,
            reasonCode: result.reasonCode,
          }
        : {}),
    });
  }
  setupSpinner.clear();

  if (instrumentationMode.id === "built-in") {
    const instrumentation = await selectBuiltInCodingTool(codingToolStatuses);
    events.setInstrumentation({
      mode: "built_in",
      codingTool: instrumentation.id,
    });
    const codingToolConfirmationStep = events.startStep(
      "coding_tool_confirmation",
    );
    const proceed = unwrap(
      await clack.select<"proceed" | "abort">({
        message: COPY.instrumentation.builtIn.proceedQuestion,
        options: [
          {
            label: COPY.instrumentation.builtIn.proceedChoices.yes.label,
            value: "proceed",
            hint: COPY.instrumentation.builtIn.proceedChoices.yes.hint,
          },
          {
            label: COPY.instrumentation.builtIn.proceedChoices.no.label,
            value: "abort",
            hint: COPY.instrumentation.builtIn.proceedChoices.no.hint,
          },
        ],
      }),
    );

    if (proceed === "proceed") {
      events.finishStep(codingToolConfirmationStep, "completed");
      const instrumentationRunStep = events.startStep("instrumentation_run", {
        failureCategory: "coding_tool_failed",
      });
      let result: InstrumentationResult;
      try {
        result = await runInstrumentation(deps, {
          org: session.orgName,
          project: session.projectName,
          apiKey: session.apiKey,
          toolId: instrumentation.id,
        });
      } catch (error) {
        events.finishStep(instrumentationRunStep, "failed", {
          failureCategory: "coding_tool_failed",
          reasonCode: "coding_tool_exception",
          instrumentationResult: "exception",
        });
        throw new WizardFailedError(
          error instanceof Error ? error.message : String(error),
          "coding_tool_failed",
          "coding_tool_exception",
        );
      }
      if (result.outcome === "completed") {
        events.finishStep(instrumentationRunStep, "completed", {
          instrumentationResult: result.instrumentationResult,
        });
        instrumentationMode = undefined;
      } else {
        events.finishStep(instrumentationRunStep, "failed", {
          failureCategory: "coding_tool_failed",
          reasonCode: result.reasonCode,
          instrumentationResult: result.instrumentationResult,
        });
        instrumentationMode = await selectAndTrackInstrumentationMode(events, {
          includeBuiltIn: false,
        });
      }
    } else {
      events.finishStep(codingToolConfirmationStep, "skipped", {
        reasonCode: "built_in_instrumentation_declined",
      });
      instrumentationMode = await selectAndTrackInstrumentationMode(events, {
        includeBuiltIn: false,
      });
    }
  }

  if (instrumentationMode?.id === "own-agent") {
    const instrumentationRunStep = events.startStep("instrumentation_run");
    await handleOwnAgentInstrumentation(deps, {
      org: session.orgName,
      project: session.projectName,
    });
    events.finishStep(instrumentationRunStep, "completed");
  } else if (instrumentationMode?.id === "manual") {
    const instrumentationRunStep = events.startStep("instrumentation_run");
    await confirmManualInstrumentation();
    events.finishStep(instrumentationRunStep, "completed");
  }

  const projectLogsUrl = `${deps.options.appUrl}/app/${encodeURIComponent(session.orgName)}/p/${encodeURIComponent(session.projectName)}/logs`;
  const traceVerificationStep = events.startStep("trace_verification", {
    failureCategory: "trace_not_observed",
  });
  const traceConfirmed = await confirmTraceLogs(projectLogsUrl);
  if (traceConfirmed) {
    events.finishStep(traceVerificationStep, "completed", {
      verificationMethod: "self_reported",
    });
  } else {
    events.finishStep(traceVerificationStep, "skipped", {
      reasonCode: "trace_check_cancelled",
    });
  }

  const productionSetupStep = events.startStep("production_setup");
  const productionConfigured = await confirmProductionApiKey();
  if (productionConfigured) {
    events.finishStep(productionSetupStep, "completed");
  } else {
    events.finishStep(productionSetupStep, "skipped", {
      reasonCode: "production_setup_cancelled",
    });
  }

  clack.outro(COPY.outro.complete({ traceConfirmed, productionConfigured }));

  return {
    orgName: session.orgName,
    projectName: session.projectName,
    braintrustApiKey: session.apiKey,
  };
}

async function loginWithBrowser(
  deps: WizardDeps,
  args: {
    readonly authMode: WizardSessionLoginUrlParams["authMode"];
    readonly wizardSession: WizardSessionCreateResponse | undefined;
  },
): Promise<WizardSessionCompleteResult> {
  const spinner = clack.spinner();
  let spinnerStarted = false;

  try {
    const session = await deps.loginWithWizardSession({
      session: args.wizardSession,
      loginUrlParams: {
        orgId: deps.options.orgId,
        projectId: deps.options.projId,
        authMode: args.authMode,
      },
      events: {
        onLoginUrl: ({ loginUrl, verificationCode }) => {
          clack.log.info(
            COPY.auth.browserLoginInfo({
              loginLink: loginUrl,
              verificationCode: pc.reset(
                pc.bold(pc.whiteBright(verificationCode)),
              ),
            }),
          );
          spinner.start(COPY.auth.waitingForBrowser);
          spinnerStarted = true;
        },
        onTryOpenBrowser: (url) => deps.openBrowser(url),
      },
    });
    if (spinnerStarted) {
      spinner.stop(
        COPY.auth.browserSetupComplete({
          orgName: pc.greenBright(session.orgName),
          projectName: pc.greenBright(session.projectName),
        }),
      );
      spinnerStarted = false;
    }
    return session;
  } finally {
    if (spinnerStarted) spinner.stop(COPY.auth.browserSetupStopped);
  }
}

async function hasBraintrustAccount(): Promise<boolean> {
  return selectBoolean({
    message: COPY.auth.accountQuestion,
    choices: COPY.auth.accountChoices,
    yesFirst: true,
  });
}

async function selectInstrumentationMode(args: {
  readonly includeBuiltIn: boolean;
}): Promise<InstrumentationModeChoice> {
  return unwrap(
    await clack.select<InstrumentationModeChoice>({
      message: COPY.instrumentation.modeQuestion,
      options: [
        ...(args.includeBuiltIn
          ? [
              {
                label: BUILT_IN_INSTRUMENTATION_CHOICE.label,
                value: BUILT_IN_INSTRUMENTATION_CHOICE,
                hint: COPY.instrumentation.modes.builtIn.hint,
              },
            ]
          : []),
        {
          label: OWN_AGENT_INSTRUMENTATION_CHOICE.label,
          value: OWN_AGENT_INSTRUMENTATION_CHOICE,
          hint: COPY.instrumentation.modes.ownAgent.hint,
        },
        {
          label: MANUAL_INSTRUMENTATION_CHOICE.label,
          value: MANUAL_INSTRUMENTATION_CHOICE,
          hint: COPY.instrumentation.modes.manual.hint,
        },
      ],
    }),
  );
}

async function selectAndTrackInstrumentationMode(
  events: WizardEventsRuntime,
  args: { readonly includeBuiltIn: boolean },
): Promise<InstrumentationModeChoice> {
  const step = events.startStep("instrumentation_selection");
  const choice = await selectInstrumentationMode(args);
  const instrumentation = {
    mode: eventInstrumentationMode(choice),
  };
  events.setInstrumentation(instrumentation);
  events.finishStep(step, "completed", { instrumentation });
  return choice;
}

function eventInstrumentationMode(
  choice: InstrumentationModeChoice,
): "built_in" | "own_agent" | "manual" {
  switch (choice.id) {
    case "built-in":
      return "built_in";
    case "own-agent":
      return "own_agent";
    case "manual":
      return "manual";
  }
}

async function handleBraintrustCliSetup(
  deps: WizardDeps,
  session: WizardSessionCompleteResult,
  spinner: WizardStepSpinner,
): Promise<BraintrustCliSetupResult> {
  let discovery = await deps.braintrustCli.discover();
  let commandPath = discovery.commandPath;

  if (discovery.installed) {
    if (commandPath) {
      let upToDate: boolean;
      try {
        const check = await deps.braintrustCli.checkForUpdate(commandPath);
        upToDate = check.upToDate;
      } catch {
        upToDate = false;
      }

      if (!upToDate) {
        const shouldUpdate = await selectBoolean({
          message: COPY.braintrustCli.updateQuestion,
          choices: COPY.braintrustCli.updateChoices,
          yesFirst: true,
        });
        if (shouldUpdate) {
          spinner.update(COPY.braintrustCli.updating);
          try {
            await deps.braintrustCli.update(commandPath);
            discovery = await deps.braintrustCli.discover();
            commandPath = discovery.commandPath ?? commandPath;
          } catch (error) {
            spinner.clear();
            clack.log.warn(
              COPY.braintrustCli.updateFailed(
                summarizeBraintrustCliError(error),
              ),
            );
          }
        }
      }
    }
  } else {
    const shouldInstall = await selectBoolean({
      message: COPY.braintrustCli.installQuestion,
      choices: COPY.braintrustCli.installChoices,
      yesFirst: true,
    });
    if (!shouldInstall) {
      return {
        outcome: "skipped",
        reasonCode: "bt_cli_install_declined",
      };
    }

    spinner.update(COPY.braintrustCli.installing);
    try {
      await deps.braintrustCli.install();
    } catch (error) {
      spinner.clear();
      clack.log.warn(
        COPY.braintrustCli.installFailed(summarizeBraintrustCliError(error)),
      );
      return { outcome: "failed", reasonCode: "bt_cli_install_failed" };
    }

    discovery = await deps.braintrustCli.discover();
    commandPath = discovery.commandPath;
    if (!discovery.installed || !commandPath) {
      spinner.clear();
      clack.log.warn(COPY.braintrustCli.installedButNotFound);
      return { outcome: "failed", reasonCode: "bt_cli_install_failed" };
    }
  }

  if (!commandPath) {
    return { outcome: "failed", reasonCode: "bt_cli_status_failed" };
  }

  let currentContext: BraintrustCliContext;
  spinner.update(COPY.braintrustCli.checkingContext);
  try {
    currentContext = await deps.braintrustCli.status(commandPath);
  } catch {
    spinner.clear();
    return { outcome: "failed", reasonCode: "bt_cli_status_failed" };
  }

  const targetContext = {
    profile: session.orgName,
    org: session.orgName,
    project: session.projectName,
  };
  if (braintrustCliContextConflicts(currentContext, targetContext)) {
    spinner.clear();
    const shouldSwitch = await selectBoolean({
      message: COPY.braintrustCli.switchContextQuestion({
        currentContext,
        targetContext,
      }),
      choices: COPY.braintrustCli.switchContextChoices,
      yesFirst: true,
    });
    if (!shouldSwitch) {
      return {
        outcome: "skipped",
        reasonCode: "bt_cli_context_switch_declined",
      };
    }

    return {
      outcome: "pending",
      backgroundTask: createBraintrustCliBackgroundTask(
        deps.braintrustCli.loginAndSwitch(commandPath, {
          apiKey: session.apiKey,
          apiUrl: deps.options.apiUrl,
          appUrl: deps.options.appUrl,
          orgName: session.orgName,
          projectName: session.projectName,
        }),
      ),
    };
  }

  return {
    outcome: "pending",
    backgroundTask: createBraintrustCliBackgroundTask(
      deps.braintrustCli.loginAndSwitch(commandPath, {
        apiKey: session.apiKey,
        apiUrl: deps.options.apiUrl,
        appUrl: deps.options.appUrl,
        orgName: session.orgName,
        projectName: session.projectName,
      }),
    ),
  };
}

function braintrustCliContextConflicts(
  current: BraintrustCliContext,
  target: Required<BraintrustCliContext>,
): boolean {
  if (
    current.profile === undefined ||
    current.org === undefined ||
    current.project === undefined
  ) {
    return false;
  }

  return (
    current.profile !== target.profile ||
    current.org !== target.org ||
    current.project !== target.project
  );
}

async function preflightCodingTools(
  deps: WizardDeps,
  spinner: WizardStepSpinner,
): Promise<readonly CodingToolStatus[]> {
  spinner.update(COPY.instrumentation.builtIn.determiningAvailable);
  try {
    const statuses = await deps.codingTools.discover();
    return await Promise.all(
      statuses.map(async (status) => {
        if (!status.usable) return status;

        try {
          await deps.codingTools.smokeTest({
            id: status.id,
            cwd: deps.cwd,
          });
          return status;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            ...status,
            usable: false,
            unavailableReason: message || "Smoke test failed.",
            unavailableReasonCode: "smoke_test_failed",
          };
        }
      }),
    );
  } finally {
    spinner.clear();
  }
}

async function selectBuiltInCodingTool(
  statuses: readonly CodingToolStatus[],
): Promise<CodingToolStatus> {
  const usable = statuses.filter((status) => status.usable);
  if (usable.length === 0) {
    warnNoUsableCodingTools(statuses);
    throw new Error(COPY.instrumentation.builtIn.noUsableToolsError);
  }

  if (usable.length === 1) {
    return usable[0]!;
  }

  const value = unwrap(
    await clack.select<CodingToolStatus>({
      message: COPY.instrumentation.builtIn.toolQuestion,
      options: [
        ...usable.map((tool) => {
          const hint = tool.authMode ?? tool.version;
          return {
            label: tool.label,
            value: tool,
            ...(hint === undefined ? {} : { hint }),
          };
        }),
      ],
    }),
  );
  return value;
}

function warnNoUsableCodingTools(statuses: readonly CodingToolStatus[]): void {
  clack.log.warn(
    COPY.instrumentation.builtIn.noUsableToolsWarning(
      statuses.map((status) =>
        COPY.instrumentation.builtIn.unavailableToolLine(
          status.label,
          COPY.instrumentation.builtIn.unavailableToolMessage(status),
        ),
      ),
    ),
  );
}

async function writeLocalEnvBraintrust(
  deps: WizardDeps,
  apiKey: string,
): Promise<string> {
  const result = await writeEnvBraintrust(deps.cwd, apiKey);
  return relative(deps.cwd, result.envFilePath);
}

async function confirmManualInstrumentation(): Promise<void> {
  unwrap(
    await clack.select<"confirm">({
      message: COPY.instrumentation.manual.completedQuestion(
        COPY.shared.instrumentationDocsUrl,
      ),
      options: [
        {
          label: COPY.instrumentation.manual.completedChoices.confirm.label,
          value: "confirm",
          hint: COPY.instrumentation.manual.completedChoices.confirm.hint,
        },
      ],
    }),
  );
}

async function handleOwnAgentInstrumentation(
  deps: WizardDeps,
  args: {
    readonly org: string;
    readonly project: string;
  },
): Promise<void> {
  const promptText = renderPrompt({
    projectName: args.project,
    appUrl: deps.options.appUrl,
  });
  const delivery = unwrap(
    await clack.select<OwnAgentPromptDelivery>({
      message: COPY.instrumentation.ownAgent.deliveryQuestion,
      options: [
        {
          label: COPY.instrumentation.ownAgent.copyToClipboard,
          value: "clipboard",
        },
        {
          label: COPY.instrumentation.ownAgent.printToTerminal,
          value: "terminal",
        },
      ],
    }),
  );

  if (delivery === "clipboard") {
    try {
      await deps.writeClipboard(promptText);
      clack.log.success(COPY.instrumentation.ownAgent.copiedToClipboard);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      clack.log.warn(COPY.instrumentation.ownAgent.clipboardFailed(message));
      printInstrumentationPrompt(promptText);
    }
  } else {
    printInstrumentationPrompt(promptText);
  }

  unwrap(
    await clack.select<"confirm">({
      message: COPY.instrumentation.ownAgent.completedQuestion,
      options: [
        {
          label: COPY.instrumentation.ownAgent.completedChoices.confirm.label,
          value: "confirm",
          hint: COPY.instrumentation.ownAgent.completedChoices.confirm.hint,
        },
      ],
    }),
  );
}

function printInstrumentationPrompt(promptText: string): void {
  process.stdout.write(`\n${promptText}\n\n`);
}

async function confirmTraceLogs(projectLogsUrl: string): Promise<boolean> {
  const decision = unwrap(
    await clack.select<"checked" | "later">({
      message: COPY.logs.checkQuestion(projectLogsUrl),
      options: [
        {
          label: COPY.logs.choices.checked.label,
          value: "checked",
          hint: COPY.logs.choices.checked.hint,
        },
        {
          label: COPY.logs.choices.later.label,
          value: "later",
          hint: COPY.logs.choices.later.hint,
        },
      ],
    }),
  );
  return decision === "checked";
}

async function confirmProductionApiKey(): Promise<boolean> {
  const decision = unwrap(
    await clack.select<"confirmed" | "later">({
      message: COPY.productionToken.question,
      options: [
        {
          label: COPY.productionToken.choices.confirmed.label,
          value: "confirmed",
          hint: COPY.productionToken.choices.confirmed.hint,
        },
        {
          label: COPY.productionToken.choices.later.label,
          value: "later",
          hint: COPY.productionToken.choices.later.hint,
        },
      ],
    }),
  );
  return decision === "confirmed";
}

type InstrumentationResult = {
  readonly tracePermalink: string | undefined;
} & (
  | {
      readonly outcome: "completed";
      readonly instrumentationResult:
        | "completed_with_marker"
        | "completed_without_marker";
    }
  | {
      readonly outcome: "failed";
      readonly instrumentationResult: "reported_incomplete" | "nonzero_exit";
      readonly reasonCode:
        | "coding_tool_reported_incomplete"
        | "coding_tool_nonzero_exit";
    }
);

async function runInstrumentation(
  deps: WizardDeps,
  args: {
    readonly org: string;
    readonly project: string;
    readonly apiKey: string;
    readonly toolId: CodingToolId;
  },
): Promise<InstrumentationResult> {
  const resultFilePath = allocateResultFile();
  const promptText = renderPrompt({
    projectName: args.project,
    appUrl: deps.options.appUrl,
  });
  const toolLabel = codingToolLabel(args.toolId);
  const spinner = clack.spinner({ indicator: "timer" });
  const renderer = new ClackToolRenderer(toolLabel);
  renderer.start();
  let toolResult: CodingToolRunResult;

  const spinnerDelay = setTimeout(() => {
    spinner.start(COPY.instrumentation.builtIn.running(toolLabel));
  }, 150);
  try {
    toolResult = await deps.codingTools.run({
      id: args.toolId,
      prompt: promptText,
      cwd: deps.cwd,
      env: {
        ...deps.env,
        BRAINTRUST_API_KEY: args.apiKey,
        BT_WIZARD_RESULT_FILE: resultFilePath,
      },
      onEvent: (event) => renderer.event(event),
    });
  } catch (error) {
    await renderer.error(COPY.instrumentation.builtIn.codingAgentFailed);
    throw error;
  } finally {
    clearTimeout(spinnerDelay);
    spinner.clear();
  }

  if (toolResult.exitCode !== 0) {
    await renderer.error(
      COPY.instrumentation.builtIn.toolExited(toolLabel, toolResult.exitCode),
    );
    clack.log.warn(
      COPY.instrumentation.builtIn.codingToolExited(toolResult.exitCode),
    );
  } else if (toolResult.finalText.includes("INSTRUMENTATION_INCOMPLETE")) {
    await renderer.error(COPY.instrumentation.builtIn.incompleteRenderer);
    clack.log.warn(COPY.instrumentation.builtIn.incompleteWarning);
  } else if (toolResult.finalText.includes("INSTRUMENTATION_COMPLETE")) {
    await renderer.success(COPY.instrumentation.builtIn.complete);
  } else {
    await renderer.success(
      COPY.instrumentation.builtIn.toolFinished(toolLabel),
    );
  }

  const tracePermalink =
    readResultFile(resultFilePath) ??
    extractTracePermalink(toolResult.finalText);
  if (toolResult.exitCode !== 0) {
    return {
      outcome: "failed",
      instrumentationResult: "nonzero_exit",
      reasonCode: "coding_tool_nonzero_exit",
      tracePermalink,
    };
  }
  if (toolResult.finalText.includes("INSTRUMENTATION_INCOMPLETE")) {
    return {
      outcome: "failed",
      instrumentationResult: "reported_incomplete",
      reasonCode: "coding_tool_reported_incomplete",
      tracePermalink,
    };
  }
  return {
    outcome: "completed",
    instrumentationResult: toolResult.finalText.includes(
      "INSTRUMENTATION_COMPLETE",
    )
      ? "completed_with_marker"
      : "completed_without_marker",
    tracePermalink,
  };
}

export type DefaultDepsArgs = {
  readonly options: WizardOptions;
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
  const clientContext = buildCliSetupClientContext(args.options, env);
  return {
    cwd,
    env,
    options: args.options,
    loginWithWizardSession: (loginArgs) =>
      loginWithWizardSessionRequest({
        appUrl: args.options.appUrl,
        // A custom app URL is useful for testing the setup flow, but telemetry
        // always belongs to the production Braintrust backend. Do not reuse a
        // production telemetry session against a different auth backend.
        session:
          args.options.appUrl === DEFAULT_APP_URL
            ? loginArgs.session
            : undefined,
        loginUrlParams: {
          orgId: loginArgs.loginUrlParams?.orgId ?? args.options.orgId,
          projectId: loginArgs.loginUrlParams?.projectId ?? args.options.projId,
          authMode: loginArgs.loginUrlParams?.authMode,
        },
        events: loginArgs.events,
      }),
    setupEvents: createWizardEvents({
      clientContext,
      createSession: (context, signal) =>
        createWizardSession(DEFAULT_APP_URL, context, signal),
    }),
    openBrowser,
    writeClipboard: (text) => clipboard.write(text),
    braintrustCli: createBraintrustCliRuntime({ env }),
    codingTools: {
      discover: discoverCodingTools,
      smokeTest: smokeTestCodingTool,
      run: runCodingTool,
    },
  };
}

// Exported for permalink construction in callers that get a span back.
export { buildLogsPermalink };

function extractTracePermalink(text: string): string | undefined {
  const match = text.match(/https?:\/\/\S+\/logs\?\S+/);
  return match?.[0]?.replace(/[),.;\]]+$/, "");
}
