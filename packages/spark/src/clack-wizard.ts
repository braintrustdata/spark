import { cwd as processCwd } from "node:process";

import pc from "picocolors";

import {
  loginWithWizardSession as loginWithWizardSessionRequest,
  type WizardSessionCompleteResult,
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
const INSTRUMENTATION_DOCS_URL =
  "https://www.braintrust.dev/docs/instrument/trace-llm-calls";

type ManualInstrumentationChoice = {
  readonly id: "manual";
  readonly label: "Manually instrument";
};

type InstrumentationChoice = CodingToolStatus | ManualInstrumentationChoice;

const MANUAL_INSTRUMENTATION_CHOICE: ManualInstrumentationChoice = {
  id: "manual",
  label: "Manually instrument",
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
  return value as T;
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
    "You'll sign in with Braintrust, choose an org and project, save an API key for this repo, then run a coding tool to add instrumentation.",
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
      : await loginWithBrowser(deps);

  const instrumentation = await selectInstrumentationChoice(deps);
  if (!isManualInstrumentationChoice(instrumentation)) {
    prompts.log.info(`Using ${instrumentation.label} for instrumentation.`);
    await deps.codingTools.smokeTest({
      id: instrumentation.id,
      cwd: deps.cwd,
    });
  }

  const gitRoot = await findGitRoot(deps.cwd);
  let envFilePath: string | undefined;
  if (gitRoot) {
    const result = await writeEnvBraintrust(gitRoot, session.apiKey);
    envFilePath = result.envFilePath;
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

  if (isManualInstrumentationChoice(instrumentation)) {
    await confirmManualInstrumentation(prompts);
  } else {
    await runInstrumentation(deps, {
      org: session.orgName,
      project: session.projectName,
      apiKey: session.apiKey,
      toolId: instrumentation.id,
    });
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
): Promise<WizardSessionCompleteResult> {
  const { prompts } = deps;
  const spinner = prompts.spinner();
  let spinnerStarted = false;

  try {
    const session = await deps.loginWithWizardSession({
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

async function selectInstrumentationChoice(
  deps: WizardDeps,
): Promise<InstrumentationChoice> {
  const { prompts } = deps;
  const statuses = await deps.codingTools.discover();
  if (deps.options.tool) {
    const selected = statuses.find((status) => status.id === deps.options.tool);
    if (!selected || !selected.usable) {
      throw new Error(
        selected
          ? buildToolUnavailableMessage(selected)
          : `Unknown coding tool: ${deps.options.tool}`,
      );
    }
    return selected;
  }

  const usable = statuses.filter((status) => status.usable);
  if (usable.length === 0 && statuses.length > 0) {
    prompts.log.warn(
      [
        "No usable coding agents found.",
        ...statuses.map(
          (status) =>
            `- ${status.label}: ${buildToolUnavailableMessage(status)}`,
        ),
      ].join("\n"),
    );
  }

  const value = unwrap(
    prompts,
    await prompts.select<InstrumentationChoice>({
      message: "Which coding agent should Braintrust Setup use?",
      options: [
        ...usable.map((tool) => ({
          label: tool.label,
          value: tool,
          hint: tool.authMode ?? tool.version,
        })),
        {
          label: MANUAL_INSTRUMENTATION_CHOICE.label,
          value: MANUAL_INSTRUMENTATION_CHOICE,
          hint: "Use the docs yourself",
        },
      ],
    }),
  );
  return value;
}

function isManualInstrumentationChoice(
  choice: InstrumentationChoice,
): choice is ManualInstrumentationChoice {
  return choice.id === "manual";
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
    yolo: deps.options.yolo,
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
    loginWithWizardSession: (events) =>
      loginWithWizardSessionRequest({ appUrl: args.options.appUrl, events }),
    openBrowser,
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
