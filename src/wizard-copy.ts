export const WIZARD_TITLE = "Braintrust Setup";

export const WIZARD_DESCRIPTION =
  "Welcome to the Braintrust setup wizard. This wizard will guide you through setting up braintrust in your project.";

export const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";

// Legacy copy used by the beau (Ink) variant. The Clack wizard uses
// device-flow login and doesn't need this prompt.
export const LOGIN_BROWSER_PROMPT =
  "For the rest of the flow, we require you to be logged in, do you want to open the browser?";

export function loginPlaceholderOutro(openBrowser: boolean): string {
  if (openBrowser) {
    return "Browser login is not wired up yet, so no browser was opened.";
  }
  return "Browser login skipped. Setup flow stops here for now.";
}

export const NOT_GIT_REPO_WARNING =
  "Heads up: this folder is not a git repository. The wizard may edit files; consider running it inside a checked-in repo.";

export const SIGNIN_URL_FALLBACK = "https://www.braintrust.dev/signin";
export const SIGNUP_URL_FALLBACK = "https://www.braintrust.dev/signup-wizard";

export const DOCS_URL = "https://www.braintrust.dev/docs";

export const WIZARD_CANCEL_MESSAGE = "Wizard cancelled.";

export const SELECT_OR_CREATE_PROJECT_QUESTION =
  "Use an existing project or create a new one?";

export const ORG_CREATE_NAME_QUESTION = "Name for the new organization?";

export const ORG_CREATE_DATA_PLANE_QUESTION = "Choose a data plane region:";

export const PROJECT_CREATE_NAME_QUESTION = "Name for the new project?";

export const ORG_SELECT_QUESTION = "Which organization?";

export const PROJECT_SELECT_QUESTION = "Which project?";

export const PROVIDER_QUESTION = "Which LLM provider are you using?";

export const PROVIDER_KEY_QUESTION = (label: string): string =>
  `Enter your ${label} API key:`;

export const RUN_HARNESS_QUESTION =
  "Run the bt-wizard coding agent harness now to instrument this repo?";

export const HARNESS_NOT_FOUND = (checked: readonly string[]): string =>
  `Couldn't find the bt-wizard harness. Looked in:\n  ${checked.join("\n  ")}`;

export function gitignoreNote(args: {
  readonly added: boolean;
  readonly alreadyCovered: boolean;
}): string {
  if (args.added) {
    return "Added .env.braintrust to .gitignore.";
  }
  if (args.alreadyCovered) {
    return ".gitignore already covers .env.braintrust.";
  }
  return ".gitignore unchanged.";
}

export function deviceCodePrompt(args: {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string | undefined;
}): string {
  const lines = [
    "Open this URL in your browser to log in:",
    `  ${args.verificationUriComplete ?? args.verificationUri}`,
  ];
  if (
    args.verificationUriComplete &&
    args.verificationUriComplete !== args.verificationUri
  ) {
    lines.push("");
    lines.push(
      `If the link above doesn't pre-fill the code, go to ${args.verificationUri} and enter:`,
    );
    lines.push(`  ${args.userCode}`);
  } else {
    lines.push("");
    lines.push(`Enter this code if prompted: ${args.userCode}`);
  }
  return lines.join("\n");
}

export function promptSavedNote(path: string): string {
  return `Wrote the agent prompt to: ${path}\nYou can run a coding agent against it manually.`;
}
