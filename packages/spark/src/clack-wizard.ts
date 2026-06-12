import { cwd as processCwd } from "node:process";
import { relative } from "node:path";

import * as clack from "@clack/prompts";
import clipboard from "clipboardy";
import pc from "picocolors";

import {
  loginWithWizardSession as loginWithWizardSessionRequest,
  type WizardSessionCompleteResult,
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
import type { WizardOptions } from "./options";
import { renderPrompt } from "./prompt";
import { ClackToolRenderer } from "./tool-ui";

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
  constructor() {
    super(WIZARD_CANCEL_MESSAGE);
    this.name = "WizardCancelledError";
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

export type WizardResult = {
  readonly orgName: string;
  readonly projectName: string;
  readonly braintrustApiKey: string;
};

export async function runClackWizard(deps: WizardDeps): Promise<WizardResult> {
  process.stdout.write("\n");
  clack.intro(COPY.welcome.intro);

  const inGitRepo = await isGitRepo(deps.cwd);
  if (!inGitRepo) {
    const continueOutsideGit = await selectBoolean({
      message: COPY.gitRepository.outsideRepoWarning,
      choices: COPY.gitRepository.continueOutsideRepoChoices,
      yesFirst: false,
    });
    if (!continueOutsideGit) {
      clack.cancel(WIZARD_CANCEL_MESSAGE);
      throw new WizardCancelledError();
    }
  } else {
    const dirtyFiles = await getUncommittedOrUntrackedFiles(deps.cwd);
    if (dirtyFiles.length > 0) {
      const continueWithDirtyRepo = await selectBoolean({
        message: COPY.gitRepository.dirtyRepoWarning(dirtyFiles),
        choices: COPY.gitRepository.continueWithDirtyRepoChoices,
        yesFirst: false,
      });
      if (!continueWithDirtyRepo) {
        clack.cancel(WIZARD_CANCEL_MESSAGE);
        throw new WizardCancelledError();
      }
    }
  }

  let session: WizardSessionCompleteResult;
  if (
    deps.options.apiKey !== undefined &&
    deps.options.projectId !== undefined
  ) {
    session = await loginWithCiCredentials({
      apiKey: deps.options.apiKey,
      projectId: deps.options.projectId,
      apiUrl: deps.options.apiUrl,
    });
  } else {
    const authMode =
      deps.options.orgId !== undefined && deps.options.projId !== undefined
        ? "signin"
        : (await hasBraintrustAccount())
          ? "signin"
          : "signup";
    session = await loginWithBrowser(deps, { authMode });
  }

  await writeLocalEnvBraintrust(deps, session.apiKey);

  const setupSpinner = new WizardStepSpinner();
  let codingToolStatuses: readonly CodingToolStatus[];
  try {
    await handleBraintrustCliSetup(deps, session, setupSpinner);
    codingToolStatuses = await preflightCodingTools(deps, setupSpinner);
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
    await selectInstrumentationMode({
      includeBuiltIn: hasUsableCodingTool,
    });

  if (instrumentationMode.id === "built-in") {
    const instrumentation = await selectBuiltInCodingTool(codingToolStatuses);
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
      await runInstrumentation(deps, {
        org: session.orgName,
        project: session.projectName,
        apiKey: session.apiKey,
        toolId: instrumentation.id,
      });
      instrumentationMode = undefined;
    } else {
      instrumentationMode = await selectInstrumentationMode({
        includeBuiltIn: false,
      });
    }
  }

  if (instrumentationMode?.id === "own-agent") {
    await handleOwnAgentInstrumentation(deps, {
      org: session.orgName,
      project: session.projectName,
    });
  } else if (instrumentationMode?.id === "manual") {
    await confirmManualInstrumentation();
  }

  const projectLogsUrl = `${deps.options.appUrl}/app/${encodeURIComponent(session.orgName)}/p/${encodeURIComponent(session.projectName)}/logs`;
  await confirmTraceLogs(projectLogsUrl);

  await confirmProductionApiKey();

  clack.outro(COPY.outro.complete);

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
  },
): Promise<WizardSessionCompleteResult> {
  const spinner = clack.spinner();
  let spinnerStarted = false;

  try {
    const session = await deps.loginWithWizardSession({
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

async function handleBraintrustCliSetup(
  deps: WizardDeps,
  session: WizardSessionCompleteResult,
  spinner: WizardStepSpinner,
): Promise<void> {
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
    if (!shouldInstall) return;

    spinner.update(COPY.braintrustCli.installing);
    try {
      await deps.braintrustCli.install();
    } catch (error) {
      spinner.clear();
      clack.log.warn(
        COPY.braintrustCli.installFailed(summarizeBraintrustCliError(error)),
      );
      return;
    }

    discovery = await deps.braintrustCli.discover();
    commandPath = discovery.commandPath;
    if (!discovery.installed || !commandPath) {
      spinner.clear();
      clack.log.warn(COPY.braintrustCli.installedButNotFound);
      return;
    }
  }

  if (!commandPath) return;

  let currentContext: BraintrustCliContext;
  spinner.update(COPY.braintrustCli.checkingContext);
  try {
    currentContext = await deps.braintrustCli.status(commandPath);
  } catch {
    spinner.clear();
    return;
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
      return;
    }
  }

  spinner.update(COPY.braintrustCli.configuringContext);
  try {
    await deps.braintrustCli.loginAndSwitch(commandPath, {
      apiKey: session.apiKey,
      apiUrl: deps.options.apiUrl,
      appUrl: deps.options.appUrl,
      orgName: session.orgName,
      projectName: session.projectName,
    });
  } catch (error) {
    spinner.clear();
    clack.log.warn(
      COPY.braintrustCli.configureFailed(summarizeBraintrustCliError(error)),
    );
  }
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

async function confirmTraceLogs(projectLogsUrl: string): Promise<void> {
  unwrap(
    await clack.select<"checked">({
      message: COPY.logs.checkQuestion(projectLogsUrl),
      options: [
        {
          label: COPY.logs.checked,
          value: "checked",
          hint: COPY.logs.hint,
        },
      ],
    }),
  );
}

async function confirmProductionApiKey(): Promise<void> {
  unwrap(
    await clack.select<"confirmed">({
      message: COPY.productionToken.question,
      options: [
        {
          label: COPY.productionToken.confirmed,
          value: "confirmed",
          hint: COPY.productionToken.hint,
        },
      ],
    }),
  );
}

type InstrumentationResult = {
  readonly tracePermalink: string | undefined;
};

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

  return {
    tracePermalink:
      readResultFile(resultFilePath) ??
      extractTracePermalink(toolResult.finalText),
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
  return {
    cwd,
    env,
    options: args.options,
    loginWithWizardSession: (loginArgs) =>
      loginWithWizardSessionRequest({
        appUrl: args.options.appUrl,
        loginUrlParams: {
          orgId: loginArgs.loginUrlParams?.orgId ?? args.options.orgId,
          projectId: loginArgs.loginUrlParams?.projectId ?? args.options.projId,
          authMode: loginArgs.loginUrlParams?.authMode,
        },
        events: loginArgs.events,
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
