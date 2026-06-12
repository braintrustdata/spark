import type { BraintrustCliContext } from "./braintrust-cli";
import chalk from "chalk";

const BRAINTRUST_CLI_CONTEXT_FALLBACKS = {
  profile: "no profile",
  org: "no org",
  project: "no project",
} as const;

const GITHUB_ISSUE_URL = "https://github.com/braintrustdata/spark/issues/new";
const SUPPORT_URL = "https://www.braintrust.dev/contact";
const INSTRUMENTATION_DOCS_URL = "https://www.braintrust.dev/docs/instrument";
const DIRTY_GIT_FILE_LIMIT = 20;

export const CLACK_WIZARD_COPY = {
  shared: {
    cancelMessage: [
      "Wizard cancelled.",
      "",
      `If you ran into an issue, please open a GitHub issue: ${GITHUB_ISSUE_URL}`,
      "",
      chalk.dim(`- Contact support: ${SUPPORT_URL}`),
      chalk.dim(`- Further documentation: ${INSTRUMENTATION_DOCS_URL}`),
    ].join("\n"),
    instrumentationDocsUrl:
      "https://www.braintrust.dev/docs/instrument/trace-llm-calls",
  },

  welcome: {
    intro: "Braintrust Setup Wizard",
  },

  gitRepository: {
    outsideRepoWarning: `${chalk.yellow.bold("Warning:")} You are running this wizard inside a folder that is not a git repository. The wizard may edit files. ${chalk.bold("Continue without a git repository?")}`,
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
    dirtyRepoWarning: (files: readonly string[]) => {
      const visibleFiles = files.slice(0, DIRTY_GIT_FILE_LIMIT);
      const remainingFileCount = files.length - visibleFiles.length;
      return [
        `${chalk.yellow.bold("Git changes detected.")} This repository already has local changes:`,
        "",
        ...visibleFiles.map((file, index) =>
          chalk.dim(`${index + 1}. ${file}`),
        ),
        ...(remainingFileCount > 0
          ? [chalk.dim(`... plus ${remainingFileCount} more`)]
          : []),
        "",
        `Braintrust Setup can continue, but its edits will be mixed with these changes. ${chalk.bold("Continue?")}`,
      ].join("\n");
    },
    continueWithDirtyRepoChoices: {
      yes: {
        label: "Yes",
        hint: "Continue",
      },
      no: {
        label: "No",
        hint: "Cancel setup and close wizard",
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
        chalk.bold(
          "Sign in to continue the setup. Your browser should have opened automatically.",
        ),
        "",
        `Verification code: ${args.verificationCode}`,
        "",
        chalk.dim(
          "If your browser didn't open automatically, open the link below to sign in:\n",
        ),
        chalk.dim(args.loginLink),
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
    checkingContext: "Checking Braintrust CLI login state...",
    configuringContext: "Configuring Braintrust CLI login state...",
    updateFailed: (message: string) =>
      `Could not update Braintrust CLI: ${message}`,
    installFailed: (message: string) =>
      `Could not install Braintrust CLI: ${message}`,
    configureFailed: (message: string) =>
      `Could not configure Braintrust CLI: ${message}`,
    installedButNotFound:
      "Braintrust CLI was installed, but the wizard could not find `bt` in PATH or the default install location. Install the CLI manually:\nhttps://www.braintrust.dev/docs/reference/cli/quickstart",
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
    modeQuestion: "How do you want to add Braintrust to your application?",
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
      determiningAvailable: "Searching for available coding agents...",
      running: (label: string) => `Running ${label}...`,
      proceedQuestion: `This setup wizard will now invoke a coding agent ${chalk.bold("with full permissions")}. Proceed?`,
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
    manual: {
      completedQuestion: (docsLink: string) =>
        [
          "Follow the Braintrust instrumentation docs for your project:",
          chalk.cyanBright(docsLink),
          "",
          chalk.bold(
            "Did you complete setting up Braintrust by following the docs?\n",
          ),
        ].join("\n"),
      completedChoices: {
        confirm: {
          label: "Confirm",
          hint: "Press Enter to continue",
        },
      },
    },
    ownAgent: {
      deliveryQuestion:
        "How do you want to receive the prompt for your coding agent?",
      copyToClipboard: "Copy to clipboard",
      printToTerminal: "Print to terminal",
      copiedToClipboard: "Copied instrumentation prompt to clipboard.",
      clipboardFailed: (message: string) =>
        `Could not copy the instrumentation prompt to the clipboard: ${message}`,
      completedQuestion:
        "Paste the above prompt into your coding agent. Press enter and proceed when the agent has completed the task.",
      completedChoices: {
        confirm: {
          label: "Confirm and proceed",
          hint: "Press Enter to continue",
        },
      },
    },
  },

  logs: {
    checkQuestion: (url: string) =>
      [
        "Your application should now be instrumented with Braintrust tracing.",
        "",
        chalk.bold(
          "Please run your app locally now, and invoke AI functionality to confirm whether AI calls are logged and traced.",
        ),
        "",
        `If everything is set up correctly, traces will appear in your Braintrust logs:\n${chalk.cyanBright(url)}`,
        "",
        chalk.dim(
          `If traces are not showing up, visit the troubleshooting guide:\nhttps://www.braintrust.dev/docs/kb/troubleshooting-guides\n`,
        ),
      ].join("\n"),
    checked: "I've confirmed my application is sending traces.",
    hint: "Press Enter to continue",
  },

  productionToken: {
    question: `Production Setup: Add the ${chalk.cyanBright("BRAINTRUST_API_KEY")} token from your local ${chalk.bold("./.env.braintrust")} file to your production environment as environment variable.\n`,
    confirmed: `I have added ${chalk.bold("BRAINTRUST_API_KEY")} to my production env.`,
    hint: "Press Enter to continue",
  },

  outro: {
    complete: [
      chalk.dim("Braintrust setup complete."),
      "",
      "You can now use Braintrust in production.",
      "",
      `If you encountered any issues during setup, please open an issue at ${GITHUB_ISSUE_URL}.`,
      "",
      chalk.dim(`- Contact support: ${SUPPORT_URL}`),
      chalk.dim(`- Further documentation: ${INSTRUMENTATION_DOCS_URL}`),
    ].join("\n"),
  },
} as const;

function formatBraintrustCliContext(context: BraintrustCliContext): string {
  const profile = context.profile ?? BRAINTRUST_CLI_CONTEXT_FALLBACKS.profile;
  const org = context.org ?? BRAINTRUST_CLI_CONTEXT_FALLBACKS.org;
  const project = context.project ?? BRAINTRUST_CLI_CONTEXT_FALLBACKS.project;
  return `${profile} (${org}/${project})`;
}
