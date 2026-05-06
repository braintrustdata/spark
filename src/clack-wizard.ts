import {
  ACCOUNT_QUESTION,
  LOGIN_BROWSER_PROMPT,
  WIZARD_CANCEL_MESSAGE,
  WIZARD_TITLE,
  loginPlaceholderOutro,
} from "./wizard-copy";

type ConfirmOptions = {
  readonly initialValue?: boolean;
  readonly message: string;
};

type PromptResult<T> = T | symbol;

export type ClackWizardPrompts = {
  readonly cancel: (message: string) => void;
  readonly confirm: (options: ConfirmOptions) => Promise<PromptResult<boolean>>;
  readonly intro: (message: string) => void;
  readonly isCancel: (value: unknown) => value is symbol;
  readonly outro: (message: string) => void;
};

export type ClackWizardResult = {
  readonly hasBraintrustAccount: boolean;
  readonly openBrowser: boolean;
};

export class WizardCancelledError extends Error {
  constructor() {
    super(WIZARD_CANCEL_MESSAGE);
    this.name = "WizardCancelledError";
  }
}

async function confirmOrCancel(prompts: ClackWizardPrompts, message: string) {
  const value = await prompts.confirm({
    initialValue: true,
    message,
  });

  if (prompts.isCancel(value)) {
    prompts.cancel(WIZARD_CANCEL_MESSAGE);
    throw new WizardCancelledError();
  }

  return value;
}

export async function runClackWizard(
  prompts: ClackWizardPrompts,
): Promise<ClackWizardResult> {
  prompts.intro(WIZARD_TITLE);

  const hasBraintrustAccount = await confirmOrCancel(prompts, ACCOUNT_QUESTION);
  const openBrowser = await confirmOrCancel(prompts, LOGIN_BROWSER_PROMPT);

  prompts.outro(loginPlaceholderOutro(openBrowser));

  return {
    hasBraintrustAccount,
    openBrowser,
  };
}
