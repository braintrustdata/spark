export const WIZARD_TITLE = "Braintrust Setup";

export const WIZARD_DESCRIPTION =
  "Welcome to the Braintrust setup wizard. This wizard will guide you through setting up braintrust in your project.";

export const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";

// Legacy copy used by the beau (Ink) variant. The Clack wizard uses
// browser-mediated wizard sign-in and doesn't need this prompt.
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

export const DOCS_URL = "https://www.braintrust.dev/docs";

export const WIZARD_CANCEL_MESSAGE = "Wizard cancelled.";

export const PROVIDER_QUESTION = "Which LLM provider are you using?";

export const PROVIDER_KEY_QUESTION = (label: string): string =>
  `Enter your ${label} API key:`;

export const RUN_HARNESS_QUESTION =
  "Run the spark coding agent harness now to instrument this repo?";

export const HARNESS_NOT_FOUND = (checked: readonly string[]): string =>
  `Couldn't find the spark harness. Looked in:\n  ${checked.join("\n  ")}`;

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

export function wizardLoginPrompt(args: { readonly loginUrl: string }): string {
  return [
    "Open this URL in your browser to finish signing in:",
    `  ${args.loginUrl}`,
    "",
    "Pick the org and project you want to use; the wizard will resume here.",
  ].join("\n");
}

export function promptSavedNote(path: string): string {
  return `Wrote the agent prompt to: ${path}\nYou can run a coding agent against it manually.`;
}
