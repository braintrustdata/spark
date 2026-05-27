import { cwd as processCwd } from "node:process";

import clipboard from "clipboardy";
import pc from "picocolors";

import {
  loginWithWizardSession as loginWithWizardSessionRequest,
  type WizardSessionCompleteResult,
  type WizardSessionLoginUrlParams,
  type WizardSessionLogin,
} from "./auth";
import { BraintrustApiClient } from "./braintrust-api";
import { openBrowser } from "./browser";
import { buildLogsPermalink } from "./cleanup";
import {
  buildToolUnavailableMessage,
  codingToolLabel,
  discoverCodingTools,
  runCodingTool,
  smokeTestCodingTool,
  type CodingToolId,
  type CodingToolEvent,
  type CodingToolRunResult,
  type CodingToolStatus,
} from "./coding-tools";
import { findGitRoot, isGitRepo, writeEnvBraintrust } from "./git";
import { allocateResultFile, readResultFile } from "./instrument";
import type { WizardOptions } from "./options";
import { renderPrompt } from "./prompt";
import { ClackToolRenderer } from "./tool-ui";
import { gitignoreNote, terminalHyperlink } from "./wizard-utils";

const WIZARD_CANCEL_MESSAGE = "Wizard cancelled.";
const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";
const INSTRUMENTATION_DOCS_URL =
  "https://www.braintrust.dev/docs/instrument/trace-llm-calls";
const ENV_BRAINTRUST_NOTICE =
  "The wizard will now create a .env.braintrust file that is used to authenticate your application to Braintrust. It will be used for local testing.";

type BuiltInInstrumentationChoice = {
  readonly id: "built-in";
  readonly label: "Use built-in coding agent";
};

type OwnAgentInstrumentationChoice = {
  readonly id: "own-agent";
  readonly label: "Use own coding agent";
};

type ManualInstrumentationChoice = {
  readonly id: "manual";
  readonly label: "Set up manually";
};

type InstrumentationModeChoice =
  | BuiltInInstrumentationChoice
  | OwnAgentInstrumentationChoice
  | ManualInstrumentationChoice;

type OwnAgentPromptDelivery = "clipboard" | "terminal";

const BUILT_IN_INSTRUMENTATION_CHOICE: BuiltInInstrumentationChoice = {
  id: "built-in",
  label: "Use built-in coding agent",
};

const OWN_AGENT_INSTRUMENTATION_CHOICE: OwnAgentInstrumentationChoice = {
  id: "own-agent",
  label: "Use own coding agent",
};

const MANUAL_INSTRUMENTATION_CHOICE: ManualInstrumentationChoice = {
  id: "manual",
  label: "Set up manually",
};

type SelectOption<T> = {
  readonly label: string;
  readonly value: T;
  readonly hint?: string | undefined;
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
  readonly spinner: () => {
    readonly start: (message?: string) => void;
    readonly stop: (message?: string) => void;
  };
  readonly codingAgentOutput?: (options: { readonly toolLabel: string }) => {
    readonly event: (event: CodingToolEvent) => void;
    readonly fail: (message: string) => Promise<void> | void;
    readonly success: (message: string) => Promise<void> | void;
  };
  readonly log: {
    readonly warn: (message: string) => void;
    readonly info: (message: string) => void;
    readonly error: (message: string) => void;
    readonly success: (message: string) => void;
    readonly message: (message: string) => void;
  };
};

export type WizardDeps = {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly options: WizardOptions;
  readonly prompts: ClackWizardPrompts;
  readonly loginWithWizardSession: WizardSessionLogin;
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly writeClipboard: (text: string) => Promise<void>;
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

export type WizardResult = {
  readonly orgName: string;
  readonly projectName: string;
  readonly braintrustApiKey: string;
};

export async function runClackWizard(deps: WizardDeps): Promise<WizardResult> {
  const { prompts } = deps;
  prompts.intro("Welcome to the Braintrust setup wizard");
  prompts.note(
    "You'll sign in with Braintrust, choose an org and project, save an API key for local testing when needed, then choose how to add instrumentation.",
    "Setup plan",
  );

  if (!(await isGitRepo(deps.cwd))) {
    prompts.log.warn(
      "Heads up: this folder is not a git repository. The wizard may edit files; consider running it inside a checked-in repo.",
    );
    const continueOutsideGit = unwrap(
      prompts,
      await prompts.confirm({
        initialValue: false,
        message: "Continue without a git repository?",
      }),
    );
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

  const instrumentationMode = await selectInstrumentationMode(prompts);

  let envFilePath: string | undefined;
  if (instrumentationMode.id === "built-in") {
    const instrumentation = await selectBuiltInCodingTool(deps);
    prompts.log.info(`Using ${instrumentation.label} for instrumentation.`);
    await deps.codingTools.smokeTest({
      id: instrumentation.id,
      cwd: deps.cwd,
    });
    envFilePath = await writeLocalEnvBraintrust(deps, session.apiKey);
    await runInstrumentation(deps, {
      org: session.orgName,
      project: session.projectName,
      apiKey: session.apiKey,
      toolId: instrumentation.id,
    });
  } else if (instrumentationMode.id === "own-agent") {
    envFilePath = await writeLocalEnvBraintrust(deps, session.apiKey);
    await handleOwnAgentInstrumentation(deps, {
      org: session.orgName,
      project: session.projectName,
      envFilePath,
    });
  } else {
    await confirmManualInstrumentation(prompts);
  }

  const projectLogsUrl = `${deps.options.appUrl}/${encodeURIComponent(session.orgName)}/p/${encodeURIComponent(session.projectName)}/logs`;
  prompts.log.info(`Check your Braintrust logs: ${projectLogsUrl}`);

  await confirmProductionApiKey(prompts, envFilePath);

  prompts.outro(
    ["Setup complete.", "", `Docs: ${INSTRUMENTATION_DOCS_URL}`].join("\n"),
  );

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
            [
              `Sign in: ${terminalHyperlink(loginUrl)}`,
              "",
              "If your browser didn't open automatically, open the link above to sign in.",
              `Verification code: ${pc.reset(pc.bold(pc.whiteBright(verificationCode)))}`,
              "",
              "Choose the org and project you want to use; the wizard will resume here.",
            ].join("\n"),
          );
          spinner.start("Waiting for login in browser...");
          spinnerStarted = true;
        },
        onTryOpenBrowser: (url) => deps.openBrowser(url),
      },
    });
    if (spinnerStarted) {
      spinner.stop(
        `Browser setup complete. (org: ${pc.greenBright(session.orgName)}, project: ${pc.greenBright(session.projectName)})`,
      );
      spinnerStarted = false;
    }
    return session;
  } finally {
    if (spinnerStarted) spinner.stop("Browser setup stopped.");
  }
}

async function hasBraintrustAccount(
  prompts: ClackWizardPrompts,
): Promise<boolean> {
  return unwrap(
    prompts,
    await prompts.confirm({
      initialValue: true,
      message: ACCOUNT_QUESTION,
    }),
  );
}

async function selectInstrumentationMode(
  prompts: ClackWizardPrompts,
): Promise<InstrumentationModeChoice> {
  return unwrap(
    prompts,
    await prompts.select<InstrumentationModeChoice>({
      message: "How do you want to add Braintrust instrumentation?",
      options: [
        {
          label: BUILT_IN_INSTRUMENTATION_CHOICE.label,
          value: BUILT_IN_INSTRUMENTATION_CHOICE,
          hint: "This wizard will launch a coding agent for you that will add instrumentation to your application (supports Claude Code and Codex). Careful: This will run the chosen tool in yolo mode (full permissions).",
        },
        {
          label: OWN_AGENT_INSTRUMENTATION_CHOICE.label,
          value: OWN_AGENT_INSTRUMENTATION_CHOICE,
          hint: "You will receive a prompt to instrument your application with your own coding agent.",
        },
        {
          label: MANUAL_INSTRUMENTATION_CHOICE.label,
          value: MANUAL_INSTRUMENTATION_CHOICE,
          hint: "Set up tracing for your application using instructions from the Braintrust docs.",
        },
      ],
    }),
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
      [
        "No usable coding agents found.",
        ...statuses.map(
          (status) =>
            `- ${status.label}: ${buildToolUnavailableMessage(status)}`,
        ),
      ].join("\n"),
    );
    throw new Error(
      "No usable coding agents found. Use your own coding agent or the Braintrust docs instead.",
    );
  }

  const value = unwrap(
    prompts,
    await prompts.select<CodingToolStatus>({
      message: "Which coding agent should Braintrust Setup use?",
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
  const gitRoot = await findGitRoot(deps.cwd);
  if (!gitRoot) {
    prompts.log.info(
      `BRAINTRUST_API_KEY=${apiKey}\nNot in a git repo — set this in your environment manually.`,
    );
    return undefined;
  }

  prompts.note(ENV_BRAINTRUST_NOTICE, "Local application token");
  const result = await writeEnvBraintrust(gitRoot, apiKey);
  prompts.log.success(`Wrote ${result.envFilePath}`);
  prompts.log.info(
    gitignoreNote({
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
    [
      "Follow the Braintrust instrumentation docs for your project.",
      "",
      terminalHyperlink(INSTRUMENTATION_DOCS_URL),
    ].join("\n"),
    "Manual instrumentation",
  );
  const completed = unwrap(
    prompts,
    await prompts.confirm({
      initialValue: false,
      message: "Have you completed the Braintrust instrumentation docs?",
    }),
  );
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
    readonly envFilePath: string | undefined;
  },
): Promise<void> {
  const { prompts } = deps;
  const promptText = `${renderPrompt({
    interactive: true,
    orgName: args.org,
    projectName: args.project,
  })}${renderOwnAgentEnvFileContext(args.envFilePath)}`;
  const delivery = unwrap(
    prompts,
    await prompts.select<OwnAgentPromptDelivery>({
      message:
        "How should Braintrust Setup deliver the instrumentation prompt?",
      options: [
        {
          label: "Copy to clipboard",
          value: "clipboard",
        },
        {
          label: "Print to terminal",
          value: "terminal",
        },
      ],
    }),
  );

  if (delivery === "clipboard") {
    try {
      await deps.writeClipboard(promptText);
      prompts.log.success("Copied instrumentation prompt to clipboard.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      prompts.log.warn(
        `Could not copy the instrumentation prompt to the clipboard: ${message}`,
      );
      printInstrumentationPrompt(prompts, promptText);
    }
  } else {
    printInstrumentationPrompt(prompts, promptText);
  }

  const completed = unwrap(
    prompts,
    await prompts.confirm({
      initialValue: false,
      message: "Has your coding agent completed Braintrust instrumentation?",
    }),
  );
  if (!completed) {
    prompts.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }
}

function printInstrumentationPrompt(
  prompts: ClackWizardPrompts,
  promptText: string,
): void {
  prompts.log.message(
    ["Braintrust instrumentation prompt:", "", promptText].join("\n"),
  );
}

function renderOwnAgentEnvFileContext(envFilePath: string | undefined): string {
  if (!envFilePath) return "";
  return `\n## Local Braintrust API Key\n\nThe wizard created \`${envFilePath}\` with BRAINTRUST_API_KEY for local verification. Use it when running the application locally, but do not commit it.\n`;
}

async function confirmProductionApiKey(
  prompts: ClackWizardPrompts,
  envFilePath: string | undefined,
): Promise<void> {
  prompts.note(
    envFilePath
      ? `The generated .env.braintrust file contains a BRAINTRUST_API_KEY token. Add that token to your deployment platform's environment variables so tracing works in production.\n\nFile: ${envFilePath}`
      : "Add the BRAINTRUST_API_KEY token to your deployment platform's environment variables so tracing works in production.",
    "Production token",
  );
  const productionTokenStatus = unwrap(
    prompts,
    await prompts.select<"done" | "later">({
      message: "Have you added BRAINTRUST_API_KEY to your deployment platform?",
      options: [
        {
          label: "I added it",
          value: "done",
        },
        {
          label: "I will do that later",
          value: "later",
        },
      ],
    }),
  );
  if (productionTokenStatus === "later") {
    prompts.log.warn(
      "Do not forget to add BRAINTRUST_API_KEY to production. Braintrust tracing will not work in production without it.",
    );
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
    interactive: false,
    yolo: true,
    resultFilePath,
    orgName: args.org,
    projectName: args.project,
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
    await renderer.error("Coding agent failed.");
    throw error;
  }

  if (toolResult.exitCode !== 0) {
    await renderer.error(
      `${toolLabel} exited with code ${toolResult.exitCode}.`,
    );
    prompts.log.warn(`Coding tool exited with code ${toolResult.exitCode}.`);
  } else if (toolResult.finalText.includes("INSTRUMENTATION_INCOMPLETE")) {
    await renderer.error("Instrumentation incomplete.");
    prompts.log.warn("The coding tool reported incomplete instrumentation.");
  } else if (toolResult.finalText.includes("INSTRUMENTATION_COMPLETE")) {
    await renderer.success("Instrumentation complete.");
  } else {
    await renderer.success(`${toolLabel} finished.`);
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
