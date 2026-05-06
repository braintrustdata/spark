export const WIZARD_TITLE = "Braintrust Setup";

export const WIZARD_DESCRIPTION =
  "Welcome to the Braintrust setup wizard. This wizard will guide you through setting up braintrust in your project.";

export const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";

export const LOGIN_BROWSER_PROMPT =
  "For the rest of the flow, we require you to be logged in, do you want to open the browser?";

export const WIZARD_CANCEL_MESSAGE = "Wizard cancelled.";

export const WIZARD_SIGNIN_LINK_TITLE = "Braintrust sign-in";

export const WIZARD_SIGNIN_RESULT_TITLE = "Braintrust credentials";

export const WIZARD_SIGNIN_COMPLETE_MESSAGE =
  "Setup received Braintrust credentials.";

export function wizardSigninLinkNote({
  loginUrl,
  expiresAt,
}: {
  readonly loginUrl: string;
  readonly expiresAt: string;
}) {
  return [
    "Open this link to sign in or sign up, then choose an organization and project:",
    loginUrl,
    "",
    `Session expires at: ${expiresAt}`,
  ].join("\n");
}

export function wizardSigninResultNote({
  orgName,
  orgId,
  projectName,
  projectId,
  apiKey,
}: {
  readonly orgName: string;
  readonly orgId: string;
  readonly projectName: string;
  readonly projectId: string;
  readonly apiKey: string;
}) {
  return [
    `Organization: ${orgName} (${orgId})`,
    `Project: ${projectName} (${projectId})`,
    `API key: ${apiKey}`,
  ].join("\n");
}
