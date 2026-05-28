import type { BraintrustCliContext } from "./braintrust-cli";

const INSTRUMENTATION_DOCS_URL =
  "https://www.braintrust.dev/docs/instrument/trace-llm-calls";
const BRAINTRUST_CLI_CONTEXT_FALLBACKS = {
  profile: "no profile",
  org: "no org",
  project: "no project",
} as const;

export const CLACK_WIZARD_COPY = {
  shared: {
    cancelMessage: "Wizard cancelled.",
    instrumentationDocsUrl: INSTRUMENTATION_DOCS_URL,
  },

  welcome: {
    intro: "Welcome to the Braintrust setup wizard",
    setupPlanTitle: "Setup plan",
    setupPlan:
      "You'll sign in with Braintrust, choose an org and project, save an API key for local testing, set up the Braintrust CLI, then choose how to add instrumentation.",
  },

  gitRepository: {
    outsideRepoWarning:
      "Heads up: this folder is not a git repository. The wizard may edit files; consider running it inside a checked-in repo.",
    continueOutsideRepoQuestion: "Continue without a git repository?",
  },

  auth: {
    accountQuestion: "Do you already have a Braintrust account?",
    browserLoginInfo: (args: {
      readonly loginLink: string;
      readonly verificationCode: string;
    }) =>
      [
        `Sign in: ${args.loginLink}`,
        "",
        "If your browser didn't open automatically, open the link above to sign in.",
        `Verification code: ${args.verificationCode}`,
        "",
        "Choose the org and project you want to use; the wizard will resume here.",
      ].join("\n"),
    waitingForBrowser: "Waiting for login in browser...",
    browserSetupComplete: (args: {
      readonly orgName: string;
      readonly projectName: string;
    }) =>
      `Browser setup complete. (org: ${args.orgName}, project: ${args.projectName})`,
    browserSetupStopped: "Browser setup stopped.",
  },

  braintrustCli: {
    installedVersionUnknown: "version unknown",
    installQuestion: "Would you like to install the Braintrust CLI?",
    updateQuestion: (installedLabel: string) =>
      `Braintrust CLI is already installed (${installedLabel}). Update it to the latest version?`,
    updated: "Updated Braintrust CLI.",
    installed: "Installed Braintrust CLI.",
    configured: "Configured Braintrust CLI.",
    updateFailed: (message: string) =>
      `Could not update Braintrust CLI: ${message}`,
    installFailed: (message: string) =>
      `Could not install Braintrust CLI: ${message}`,
    configureFailed: (message: string) =>
      `Could not configure Braintrust CLI: ${message}`,
    installedButNotFound:
      "Braintrust CLI was installed, but the wizard could not find `bt` in PATH or the default install location. Open a new shell and run `bt status` to verify it.",
    statusFailed: (message: string) =>
      `Could not inspect Braintrust CLI status; leaving existing CLI context unchanged. ${message}`,
    switchContextQuestion: (args: {
      readonly currentContext: BraintrustCliContext;
      readonly targetContext: BraintrustCliContext;
    }) =>
      `Braintrust CLI is currently configured for ${formatBraintrustCliContext(args.currentContext)}. Switch it to ${formatBraintrustCliContext(args.targetContext)}?`,
    leavingContextUnchanged:
      "Leaving existing Braintrust CLI context unchanged.",
    contextFallbacks: {
      ...BRAINTRUST_CLI_CONTEXT_FALLBACKS,
    },
  },

  instrumentation: {
    modeQuestion: "How do you want to add Braintrust instrumentation?",
    modes: {
      builtIn: {
        label: "Use built-in coding agent",
        hint: "This wizard will launch a coding agent for you that will add instrumentation to your application (supports Claude Code and Codex). Careful: This will run the chosen tool in yolo mode (full permissions).",
      },
      ownAgent: {
        label: "Use own coding agent",
        hint: "You will receive a prompt to instrument your application with your own coding agent.",
      },
      manual: {
        label: "Set up manually",
        hint: "Set up tracing for your application using instructions from the Braintrust docs.",
      },
    },
    builtIn: {
      usingTool: (label: string) => `Using ${label} for instrumentation.`,
      toolQuestion: "Which coding agent should Braintrust Setup use?",
      noUsableToolsWarning: (toolMessages: readonly string[]) =>
        ["No usable coding agents found.", ...toolMessages].join("\n"),
      unavailableToolMessage: (args: {
        readonly label: string;
        readonly installed: boolean;
        readonly unavailableReason?: string | undefined;
      }) => {
        if (!args.installed) return `${args.label} is not installed.`;
        return args.unavailableReason ?? `${args.label} is not usable.`;
      },
      unavailableToolLine: (toolLabel: string, unavailableMessage: string) =>
        `- ${toolLabel}: ${unavailableMessage}`,
      noUsableToolsError:
        "No usable coding agents found. Use your own coding agent or the Braintrust docs instead.",
      codingAgentFailed: "Coding agent failed.",
      toolExited: (toolLabel: string, exitCode: number) =>
        `${toolLabel} exited with code ${exitCode}.`,
      codingToolExited: (exitCode: number) =>
        `Coding tool exited with code ${exitCode}.`,
      incompleteRenderer: "Instrumentation incomplete.",
      incompleteWarning: "The coding tool reported incomplete instrumentation.",
      complete: "Instrumentation complete.",
      toolFinished: (toolLabel: string) => `${toolLabel} finished.`,
    },
    localToken: {
      title: "Local application token",
      notice:
        "The wizard will now create a .env.braintrust file that is used to authenticate your application to Braintrust. It will be used for local testing.",
      existingNotice:
        "A .env.braintrust file already exists. The wizard can replace it with the API key for this Braintrust project.",
      replaceQuestion:
        ".env.braintrust already exists. Replace it with this project's Braintrust API key?",
      outsideGitRepo: (apiKey: string) =>
        `BRAINTRUST_API_KEY=${apiKey}\nNot in a git repo — set this in your environment manually.`,
      wroteEnvFile: (path: string) => `Wrote ${path}`,
      keptEnvFile: (path: string) => `Kept existing ${path} unchanged.`,
      gitignoreNote: (args: {
        readonly added: boolean;
        readonly alreadyCovered: boolean;
      }) => {
        if (args.added) return "Added .env.braintrust to .gitignore.";
        if (args.alreadyCovered) {
          return ".gitignore already covers .env.braintrust.";
        }
        return ".gitignore unchanged.";
      },
    },
    manual: {
      title: "Manual instrumentation",
      note: (docsLink: string) =>
        [
          "Follow the Braintrust instrumentation docs for your project.",
          "",
          docsLink,
        ].join("\n"),
      completedQuestion:
        "Have you completed the Braintrust instrumentation docs?",
    },
    ownAgent: {
      deliveryQuestion:
        "How should Braintrust Setup deliver the instrumentation prompt?",
      copyToClipboard: "Copy to clipboard",
      printToTerminal: "Print to terminal",
      copiedToClipboard: "Copied instrumentation prompt to clipboard.",
      clipboardFailed: (message: string) =>
        `Could not copy the instrumentation prompt to the clipboard: ${message}`,
      completedQuestion:
        "Has your coding agent completed Braintrust instrumentation?",
      promptHeader: "Braintrust instrumentation prompt:",
      localApiKeyContext: (envFilePath: string) =>
        `\n## Local Braintrust API Key\n\nThe wizard wrote \`${envFilePath}\` with BRAINTRUST_API_KEY for local verification. Use it when running the application locally, but do not commit it.\n`,
    },
  },

  logs: {
    projectLogsUrl: (url: string) => `Check your Braintrust logs: ${url}`,
  },

  productionToken: {
    title: "Production token",
    noteWithEnvFile: (envFilePath: string) =>
      `The local .env.braintrust file contains a BRAINTRUST_API_KEY token. Add that token to your deployment platform's environment variables so tracing works in production.\n\nFile: ${envFilePath}`,
    noteWithoutEnvFile:
      "Add the BRAINTRUST_API_KEY token to your deployment platform's environment variables so tracing works in production.",
    question: "Have you added BRAINTRUST_API_KEY to your deployment platform?",
    addedIt: "I added it",
    doLater: "I will do that later",
    laterWarning:
      "Do not forget to add BRAINTRUST_API_KEY to production. Braintrust tracing will not work in production without it.",
  },

  outro: {
    complete: (docsUrl: string) =>
      ["Setup complete.", "", `Docs: ${docsUrl}`].join("\n"),
  },
} as const;

function formatBraintrustCliContext(context: BraintrustCliContext): string {
  const profile = context.profile ?? BRAINTRUST_CLI_CONTEXT_FALLBACKS.profile;
  const org = context.org ?? BRAINTRUST_CLI_CONTEXT_FALLBACKS.org;
  const project = context.project ?? BRAINTRUST_CLI_CONTEXT_FALLBACKS.project;
  return `${profile} (${org}/${project})`;
}
