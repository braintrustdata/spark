import type { BraintrustCliContext } from "./braintrust-cli";

const INSTRUMENTATION_DOCS_URL =
  "https://www.braintrust.dev/docs/instrument/trace-llm-calls";
const SETUP_PLAN =
  "You'll sign in with Braintrust, choose an org and project, save an API key for local testing, set up the Braintrust CLI, then choose how to add instrumentation.";
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
    intro: [
      "Welcome to the Braintrust setup wizard",
      "",
      "Setup plan:",
      SETUP_PLAN,
    ].join("\n"),
  },

  gitRepository: {
    outsideRepoWarning:
      "Heads up: this folder is not a git repository. The wizard may edit files; consider running it inside a checked-in repo.",
    continueOutsideRepoQuestion: "Continue without a git repository?",
    continueOutsideRepoChoices: {
      yes: {
        label: "Yes",
        hint: "Continue setup",
      },
      no: {
        label: "No (recommended)",
        hint: "Stop wizard",
      },
    },
  },

  auth: {
    accountQuestion: "Do you already have a Braintrust account?",
    accountChoices: {
      yes: {
        label: "Yes",
        hint: "Sign in",
      },
      no: {
        label: "No",
        hint: "Create account",
      },
    },
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
    installQuestion: "Install Braintrust CLI?",
    installChoices: {
      yes: {
        label: "Yes (recommended)",
        hint: "Install CLI",
      },
      no: {
        label: "No",
        hint: "Skip installation",
      },
    },
    updateQuestion: (installedLabel: string) =>
      `Update Braintrust CLI? (${installedLabel} installed)`,
    updateChoices: {
      yes: {
        label: "Yes (recommended)",
        hint: "Update CLI",
      },
      no: {
        label: "No",
        hint: "Keep current version",
      },
    },
    installing: "Installing Braintrust CLI...",
    updating: "Updating Braintrust CLI...",
    checkingContext: "Checking Braintrust CLI context...",
    configuringContext: "Configuring Braintrust CLI context...",
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
      `Switch Braintrust CLI from ${formatBraintrustCliContext(args.currentContext)} to ${formatBraintrustCliContext(args.targetContext)}?`,
    switchContextChoices: {
      yes: {
        label: "Yes (recommended)",
        hint: "Use this project",
      },
      no: {
        label: "No",
        hint: "Keep existing context",
      },
    },
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
      determiningAvailable: "Determining available coding agents...",
      running: (label: string) => `Running ${label}...`,
      proceedQuestion:
        "This setup wizard will now invoke a coding agent. Proceed?",
      proceedChoices: {
        yes: {
          label: "Yes, proceed",
          hint: "Run the selected coding agent",
        },
        no: {
          label: "abort",
          hint: "Choose another setup path",
        },
      },
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
        "The wizard will now create .env.braintrust and .braintrust.json files that are used to authenticate your application to Braintrust. They will be used for local testing.",
      existingNotice:
        "A local Braintrust token file already exists. The wizard can replace local token files with the API key for this Braintrust project.",
      replaceQuestion: "Replace local Braintrust token files?",
      replaceChoices: {
        yes: {
          label: "Yes (recommended)",
          hint: "Use this project key",
        },
        no: {
          label: "No",
          hint: "Keep existing file",
        },
      },
      outsideGitRepo: (apiKey: string) =>
        `BRAINTRUST_API_KEY=${apiKey}\nNot in a git repo — set this in your environment manually.`,
      keptTokenFiles: () =>
        "Kept existing local Braintrust token files unchanged.",
      gitignoreNote: (args: {
        readonly added: boolean;
        readonly alreadyCovered: boolean;
      }) => {
        if (args.added) {
          return "Updated .gitignore for local Braintrust token files.";
        }
        if (args.alreadyCovered) {
          return undefined;
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
      completedQuestion: "Braintrust instrumentation completed?",
      completedChoices: {
        confirm: {
          label: "confirm",
          hint: "Continue setup",
        },
      },
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
        "Give the above prompt to your coding agent and proceed when the agent has completed the task.",
      completedChoices: {
        confirm: {
          label: "Confirm and proceed",
          hint: "Continue setup",
        },
      },
    },
  },

  logs: {
    projectLogsUrl: (url: string) => `Check your Braintrust logs: ${url}`,
  },

  productionToken: {
    title: "Production token",
    noteWithEnvFile: (envFilePath: string) =>
      `The local Braintrust token files contain a BRAINTRUST_API_KEY token. Add that token to your deployment platform's environment variables so tracing works in production.\n\nEnv file: ${envFilePath}`,
    noteWithoutEnvFile:
      "Add the BRAINTRUST_API_KEY token to your deployment platform's environment variables so tracing works in production.",
    question: "Have you added BRAINTRUST_API_KEY to your deployment platform?",
    understood: "Understood",
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
