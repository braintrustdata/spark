import type { BraintrustCliContext } from "./braintrust-cli";

const BRAINTRUST_CLI_CONTEXT_FALLBACKS = {
  profile: "no profile",
  org: "no org",
  project: "no project",
} as const;

export const CLACK_WIZARD_COPY = {
  shared: {
    cancelMessage: "Wizard cancelled.",
    instrumentationDocsUrl:
      "https://www.braintrust.dev/docs/instrument/trace-llm-calls",
  },

  welcome: {
    intro: "Braintrust Setup Wizard",
  },

  gitRepository: {
    outsideRepoWarning:
      "Warning: You are running this wizard inside a folder that is not a git repository. The wizard may edit files.",
    continueOutsideRepoQuestion: "Continue without a git repository?",
    continueOutsideRepoChoices: {
      yes: {
        label: "Yes",
        hint: "Continue without git",
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
        hint: "Sign up",
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
      ].join("\n"),
    waitingForBrowser: "Waiting for you to sign in via the browser...",
    browserSetupComplete: (args: {
      readonly orgName: string;
      readonly projectName: string;
    }) =>
      `Browser setup complete. (org: ${args.orgName}, project: ${args.projectName})`,
    browserSetupStopped: "Browser setup cancelled.",
  },

  braintrustCli: {
    installQuestion: "Install Braintrust CLI?",
    installChoices: {
      yes: {
        label: "Yes (recommended)",
      },
      no: {
        label: "No",
        hint: "Skip CLI installation",
      },
    },
    updateQuestion: "Update Braintrust CLI to the latest version?",
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
      `Switch Braintrust CLI login profile from ${formatBraintrustCliContext(args.currentContext)} to ${formatBraintrustCliContext(args.targetContext)}?`,
    switchContextChoices: {
      yes: {
        label: "Yes (recommended)",
        hint: "Use project selected in browser",
      },
      no: {
        label: "No",
        hint: "Keep current profile",
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
        hint: "Launch a locally installed coding agent",
      },
      ownAgent: {
        label: "Use own coding agent",
        hint: "Use a suggested prompt to pass to your own coding agent",
      },
      manual: {
        label: "Set up manually",
        hint: "Use the Braintrust docs",
      },
    },
    builtIn: {
      determiningAvailable: "Scanning for available coding agents...",
      running: (label: string) => `Running ${label}...`,
      proceedQuestion:
        "This setup wizard will now invoke a coding agent with full permissions. Proceed?",
      proceedChoices: {
        yes: {
          label: "Confirm",
          hint: "Run the coding agent",
        },
        no: {
          label: "Abort",
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
        `Coding agent exited with code ${exitCode}.`,
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
