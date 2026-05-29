import { cwd as processCwd } from "node:process";

import type {
  TaskLogCompletionOptions,
  TaskLogMessageOptions,
  TaskLogOptions,
} from "@clack/prompts";
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
  braintrustTokenFilesExist,
  ensureEnvBraintrustIgnored,
  isGitRepo,
  writeEnvBraintrust,
} from "./git";
import { allocateResultFile, readResultFile } from "./instrument";
import type { WizardOptions } from "./options";
import { renderPrompt } from "./prompt";
import { ClackToolRenderer } from "./tool-ui";
import { terminalHyperlink } from "./wizard-utils";

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

type SelectOption<T> = {
  readonly label: string;
  readonly value: T;
  readonly hint?: string | undefined;
};

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

type CodingAgentOutput = {
  readonly message: (message: string) => Promise<void> | void;
  readonly fail: (message: string) => Promise<void> | void;
  readonly success: (message: string) => Promise<void> | void;
};

type ClackTaskLog = {
  readonly message: (message: string, options?: TaskLogMessageOptions) => void;
  readonly error: (message: string, options?: TaskLogCompletionOptions) => void;
  readonly success: (
    message: string,
    options?: TaskLogCompletionOptions,
  ) => void;
};

export type ClackWizardPrompts = {
  readonly cancel: (message: string) => void;
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
  readonly spinner: () => {
    readonly start: (message?: string) => void;
    readonly stop: (message?: string) => void;
  };
  readonly codingAgentOutput?: (options: {
    readonly title: string;
    readonly toolLabel: string;
  }) => CodingAgentOutput;
  readonly taskLog?: (options: TaskLogOptions) => ClackTaskLog;
  readonly log: {
    readonly warn: (message: string) => void;
    readonly info: (message: string) => void;
    readonly error: (message: string) => void;
    readonly success: (message: string) => void;
    readonly message: (message: string) => void;
  };
  readonly writeRaw: (message: string) => void;
};

export type WizardDeps = {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly options: WizardOptions;
  readonly prompts: ClackWizardPrompts;
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

function unwrap<T>(prompts: ClackWizardPrompts, value: T | symbol): T {
  if (prompts.isCancel(value)) {
    prompts.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }
  return value;
}

async function selectBoolean(
  prompts: ClackWizardPrompts,
  args: {
    readonly message: string;
    readonly choices: BooleanSelectChoices;
    readonly yesFirst: boolean;
  },
): Promise<boolean> {
  const yesOption = {
    label: args.choices.yes.label,
    value: true,
    hint: args.choices.yes.hint,
  };
  const noOption = {
    label: args.choices.no.label,
    value: false,
    hint: args.choices.no.hint,
  };
  return unwrap(
    prompts,
    await prompts.select<boolean>({
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
  const { prompts } = deps;
  prompts.intro(COPY.welcome.intro);
  prompts.note(COPY.welcome.setupPlan, COPY.welcome.setupPlanTitle);

  if (!(await isGitRepo(deps.cwd))) {
    prompts.log.warn(COPY.gitRepository.outsideRepoWarning);
    const continueOutsideGit = await selectBoolean(prompts, {
      message: COPY.gitRepository.continueOutsideRepoQuestion,
      choices: COPY.gitRepository.continueOutsideRepoChoices,
      yesFirst: false,
    });
    if (!continueOutsideGit) {
      prompts.cancel(WIZARD_CANCEL_MESSAGE);
      throw new WizardCancelledError();
    }
  }

  const session =
    deps.options.apiKey !== undefined && deps.options.projectId !== undefined
      ? await loginWithCiCredentials({
          apiKey: deps.options.apiKey,
          projectId: deps.options.projectId,
          apiUrl: deps.options.apiUrl,
        })
      : await loginWithBrowser(deps, {
          authMode: (await hasBraintrustAccount(prompts)) ? "signin" : "signup",
        });

  const envFilePath = await writeLocalEnvBraintrust(deps, session.apiKey);

  await handleBraintrustCliSetup(deps, session);

  const instrumentationMode = await selectInstrumentationMode(prompts);

  if (instrumentationMode.id === "built-in") {
    const instrumentation = await selectBuiltInCodingTool(deps);
    prompts.log.info(
      COPY.instrumentation.builtIn.usingTool(instrumentation.label),
    );
    await deps.codingTools.smokeTest({
      id: instrumentation.id,
      cwd: deps.cwd,
    });
    await runInstrumentation(deps, {
      org: session.orgName,
      project: session.projectName,
      apiKey: session.apiKey,
      toolId: instrumentation.id,
    });
  } else if (instrumentationMode.id === "own-agent") {
    await handleOwnAgentInstrumentation(deps, {
      org: session.orgName,
      project: session.projectName,
    });
  } else {
    await confirmManualInstrumentation(prompts);
  }

  const projectLogsUrl = `${deps.options.appUrl}/${encodeURIComponent(session.orgName)}/p/${encodeURIComponent(session.projectName)}/logs`;
  prompts.log.info(COPY.logs.projectLogsUrl(projectLogsUrl));

  await confirmProductionApiKey(prompts, envFilePath);

  prompts.outro(COPY.outro.complete(COPY.shared.instrumentationDocsUrl));

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
  const { prompts } = deps;
  const spinner = prompts.spinner();
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
          prompts.log.info(
            COPY.auth.browserLoginInfo({
              loginLink: terminalHyperlink(loginUrl),
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

async function hasBraintrustAccount(
  prompts: ClackWizardPrompts,
): Promise<boolean> {
  return selectBoolean(prompts, {
    message: COPY.auth.accountQuestion,
    choices: COPY.auth.accountChoices,
    yesFirst: true,
  });
}

async function selectInstrumentationMode(
  prompts: ClackWizardPrompts,
): Promise<InstrumentationModeChoice> {
  return unwrap(
    prompts,
    await prompts.select<InstrumentationModeChoice>({
      message: COPY.instrumentation.modeQuestion,
      options: [
        {
          label: BUILT_IN_INSTRUMENTATION_CHOICE.label,
          value: BUILT_IN_INSTRUMENTATION_CHOICE,
          hint: COPY.instrumentation.modes.builtIn.hint,
        },
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
): Promise<void> {
  const { prompts } = deps;
  let discovery = await deps.braintrustCli.discover();
  let commandPath = discovery.commandPath;

  if (discovery.installed) {
    const installedLabel =
      discovery.version ??
      commandPath ??
      COPY.braintrustCli.installedVersionUnknown;
    const shouldUpdate = await selectBoolean(prompts, {
      message: COPY.braintrustCli.updateQuestion(installedLabel),
      choices: COPY.braintrustCli.updateChoices,
      yesFirst: true,
    });
    if (shouldUpdate && commandPath) {
      const spinner = prompts.spinner();
      spinner.start(COPY.braintrustCli.updating);
      try {
        await deps.braintrustCli.update(commandPath);
        spinner.stop(COPY.braintrustCli.updated);
        discovery = await deps.braintrustCli.discover();
        commandPath = discovery.commandPath ?? commandPath;
      } catch (error) {
        spinner.stop(COPY.braintrustCli.updateStopped);
        prompts.log.warn(
          COPY.braintrustCli.updateFailed(summarizeBraintrustCliError(error)),
        );
      }
    }
  } else {
    const shouldInstall = await selectBoolean(prompts, {
      message: COPY.braintrustCli.installQuestion,
      choices: COPY.braintrustCli.installChoices,
      yesFirst: true,
    });
    if (!shouldInstall) return;

    const spinner = prompts.spinner();
    spinner.start(COPY.braintrustCli.installing);
    try {
      await deps.braintrustCli.install();
      spinner.stop(COPY.braintrustCli.installed);
    } catch (error) {
      spinner.stop(COPY.braintrustCli.installStopped);
      prompts.log.warn(
        COPY.braintrustCli.installFailed(summarizeBraintrustCliError(error)),
      );
      return;
    }

    discovery = await deps.braintrustCli.discover();
    commandPath = discovery.commandPath;
    if (!discovery.installed || !commandPath) {
      prompts.log.warn(COPY.braintrustCli.installedButNotFound);
      return;
    }
  }

  if (!commandPath) return;

  let currentContext: BraintrustCliContext;
  try {
    currentContext = await deps.braintrustCli.status(commandPath);
  } catch (error) {
    prompts.log.warn(
      COPY.braintrustCli.statusFailed(summarizeBraintrustCliError(error)),
    );
    return;
  }

  const targetContext = {
    profile: session.orgName,
    org: session.orgName,
    project: session.projectName,
  };
  if (braintrustCliContextConflicts(currentContext, targetContext)) {
    const shouldSwitch = await selectBoolean(prompts, {
      message: COPY.braintrustCli.switchContextQuestion({
        currentContext,
        targetContext,
      }),
      choices: COPY.braintrustCli.switchContextChoices,
      yesFirst: false,
    });
    if (!shouldSwitch) {
      prompts.log.info(COPY.braintrustCli.leavingContextUnchanged);
      return;
    }
  }

  try {
    await deps.braintrustCli.loginAndSwitch(commandPath, {
      apiKey: session.apiKey,
      apiUrl: deps.options.apiUrl,
      appUrl: deps.options.appUrl,
      orgName: session.orgName,
      projectName: session.projectName,
    });
    prompts.log.success(COPY.braintrustCli.configured);
  } catch (error) {
    prompts.log.warn(
      COPY.braintrustCli.configureFailed(summarizeBraintrustCliError(error)),
    );
  }
}

function braintrustCliContextConflicts(
  current: BraintrustCliContext,
  target: Required<BraintrustCliContext>,
): boolean {
  return (
    (current.profile !== undefined && current.profile !== target.profile) ||
    (current.org !== undefined && current.org !== target.org) ||
    (current.project !== undefined && current.project !== target.project)
  );
}

async function selectBuiltInCodingTool(
  deps: WizardDeps,
): Promise<CodingToolStatus> {
  const { prompts } = deps;
  const statuses = await deps.codingTools.discover();

  const usable = statuses.filter((status) => status.usable);
  if (usable.length === 0) {
    prompts.log.warn(
      COPY.instrumentation.builtIn.noUsableToolsWarning(
        statuses.map((status) =>
          COPY.instrumentation.builtIn.unavailableToolLine(
            status.label,
            COPY.instrumentation.builtIn.unavailableToolMessage(status),
          ),
        ),
      ),
    );
    throw new Error(COPY.instrumentation.builtIn.noUsableToolsError);
  }

  const value = unwrap(
    prompts,
    await prompts.select<CodingToolStatus>({
      message: COPY.instrumentation.builtIn.toolQuestion,
      options: [
        ...usable.map((tool) => ({
          label: tool.label,
          value: tool,
          hint: tool.authMode ?? tool.version,
        })),
      ],
    }),
  );
  return value;
}

async function writeLocalEnvBraintrust(
  deps: WizardDeps,
  apiKey: string,
): Promise<string | undefined> {
  const { prompts } = deps;
  const targetDirectory = deps.cwd;
  if (await braintrustTokenFilesExist(targetDirectory)) {
    prompts.note(
      COPY.instrumentation.localToken.existingNotice,
      COPY.instrumentation.localToken.title,
    );
    const shouldReplace = await selectBoolean(prompts, {
      message: COPY.instrumentation.localToken.replaceQuestion,
      choices: COPY.instrumentation.localToken.replaceChoices,
      yesFirst: false,
    });
    if (!shouldReplace) {
      const gitignoreResult = await ensureEnvBraintrustIgnored(targetDirectory);
      prompts.log.info(COPY.instrumentation.localToken.keptTokenFiles());
      prompts.log.info(
        COPY.instrumentation.localToken.gitignoreNote({
          added: gitignoreResult.addedToGitignore,
          alreadyCovered: gitignoreResult.alreadyCovered,
        }),
      );
      return undefined;
    }
  } else {
    prompts.note(
      COPY.instrumentation.localToken.notice,
      COPY.instrumentation.localToken.title,
    );
  }

  const result = await writeEnvBraintrust(targetDirectory, apiKey);
  prompts.log.success(
    COPY.instrumentation.localToken.wroteTokenFiles({
      envFilePath: result.envFilePath,
      braintrustJsonFilePath: result.braintrustJsonFilePath,
    }),
  );
  prompts.log.info(
    COPY.instrumentation.localToken.gitignoreNote({
      added: result.addedToGitignore,
      alreadyCovered: result.alreadyCovered,
    }),
  );
  return result.envFilePath;
}

async function confirmManualInstrumentation(
  prompts: ClackWizardPrompts,
): Promise<void> {
  prompts.note(
    COPY.instrumentation.manual.note(
      terminalHyperlink(COPY.shared.instrumentationDocsUrl),
    ),
    COPY.instrumentation.manual.title,
  );
  const completed = await selectBoolean(prompts, {
    message: COPY.instrumentation.manual.completedQuestion,
    choices: COPY.instrumentation.manual.completedChoices,
    yesFirst: false,
  });
  if (!completed) {
    prompts.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }
}

async function handleOwnAgentInstrumentation(
  deps: WizardDeps,
  args: {
    readonly org: string;
    readonly project: string;
  },
): Promise<void> {
  const { prompts } = deps;
  const promptText = renderPrompt({
    projectName: args.project,
    appUrl: deps.options.appUrl,
  });
  const delivery = unwrap(
    prompts,
    await prompts.select<OwnAgentPromptDelivery>({
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
      prompts.log.success(COPY.instrumentation.ownAgent.copiedToClipboard);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      prompts.log.warn(COPY.instrumentation.ownAgent.clipboardFailed(message));
      printInstrumentationPrompt(prompts, promptText);
    }
  } else {
    printInstrumentationPrompt(prompts, promptText);
  }

  const completed = await selectBoolean(prompts, {
    message: COPY.instrumentation.ownAgent.completedQuestion,
    choices: COPY.instrumentation.ownAgent.completedChoices,
    yesFirst: false,
  });
  if (!completed) {
    prompts.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }
}

function printInstrumentationPrompt(
  prompts: ClackWizardPrompts,
  promptText: string,
): void {
  prompts.writeRaw(
    `\n${COPY.instrumentation.ownAgent.promptHeader}\n\n${promptText}\n\n`,
  );
}

async function confirmProductionApiKey(
  prompts: ClackWizardPrompts,
  envFilePath: string | undefined,
): Promise<void> {
  prompts.note(
    envFilePath
      ? COPY.productionToken.noteWithEnvFile(envFilePath)
      : COPY.productionToken.noteWithoutEnvFile,
    COPY.productionToken.title,
  );
  const productionTokenStatus = unwrap(
    prompts,
    await prompts.select<"done" | "later">({
      message: COPY.productionToken.question,
      options: [
        {
          label: COPY.productionToken.addedIt,
          value: "done",
        },
        {
          label: COPY.productionToken.doLater,
          value: "later",
        },
      ],
    }),
  );
  if (productionTokenStatus === "later") {
    prompts.log.warn(COPY.productionToken.laterWarning);
  }
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
  const { prompts } = deps;
  const resultFilePath = allocateResultFile();
  const promptText = renderPrompt({
    projectName: args.project,
    appUrl: deps.options.appUrl,
  });
  const toolLabel = codingToolLabel(args.toolId);
  const renderer = new ClackToolRenderer(prompts, toolLabel);
  let toolResult: CodingToolRunResult;
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
  }

  if (toolResult.exitCode !== 0) {
    await renderer.error(
      COPY.instrumentation.builtIn.toolExited(toolLabel, toolResult.exitCode),
    );
    prompts.log.warn(
      COPY.instrumentation.builtIn.codingToolExited(toolResult.exitCode),
    );
  } else if (toolResult.finalText.includes("INSTRUMENTATION_INCOMPLETE")) {
    await renderer.error(COPY.instrumentation.builtIn.incompleteRenderer);
    prompts.log.warn(COPY.instrumentation.builtIn.incompleteWarning);
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
  return {
    cwd,
    env,
    options: args.options,
    prompts: args.prompts,
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
