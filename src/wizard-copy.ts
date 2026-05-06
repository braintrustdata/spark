export const WIZARD_TITLE = "Braintrust Setup";

export const WIZARD_DESCRIPTION =
  "Welcome to the Braintrust setup wizard. This wizard will guide you through setting up braintrust in your project.";

export const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";

export const LOGIN_BROWSER_PROMPT =
  "For the rest of the flow, we require you to be logged in, do you want to open the browser?";

export const WIZARD_CANCEL_MESSAGE = "Wizard cancelled.";

export function loginPlaceholderOutro(openBrowser: boolean) {
  if (openBrowser) {
    return "Browser login is not wired up yet, so no browser was opened.";
  }

  return "Browser login skipped. Setup flow stops here for now.";
}
