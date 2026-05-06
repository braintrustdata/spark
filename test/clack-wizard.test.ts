import { describe, expect, it } from "vitest";

import {
  runClackWizard,
  type ClackWizardPrompts,
  WizardCancelledError,
} from "../src/clack-wizard";
import {
  ACCOUNT_QUESTION,
  LOGIN_BROWSER_PROMPT,
  WIZARD_CANCEL_MESSAGE,
  WIZARD_TITLE,
  loginPlaceholderOutro,
} from "../src/wizard-copy";

const CANCEL = Symbol("cancel");

type ConfirmCall = {
  readonly initialValue?: boolean;
  readonly message: string;
};

function createPrompts(answers: Array<boolean | typeof CANCEL>) {
  const confirmCalls: ConfirmCall[] = [];
  const events: string[] = [];

  const prompts: ClackWizardPrompts = {
    cancel(message) {
      events.push(`cancel:${message}`);
    },
    async confirm(options) {
      confirmCalls.push(options);

      const answer = answers.shift();

      if (answer === undefined) {
        throw new Error("No fake answer was provided.");
      }

      return answer;
    },
    intro(message) {
      events.push(`intro:${message}`);
    },
    isCancel(value): value is symbol {
      return value === CANCEL;
    },
    outro(message) {
      events.push(`outro:${message}`);
    },
  };

  return {
    confirmCalls,
    events,
    prompts,
  };
}

describe("runClackWizard", () => {
  it("asks both questions in order", async () => {
    const { confirmCalls, events, prompts } = createPrompts([true, true]);

    await expect(runClackWizard(prompts)).resolves.toEqual({
      hasBraintrustAccount: true,
      openBrowser: true,
    });

    expect(events).toEqual([
      `intro:${WIZARD_TITLE}`,
      `outro:${loginPlaceholderOutro(true)}`,
    ]);
    expect(confirmCalls).toEqual([
      { initialValue: true, message: ACCOUNT_QUESTION },
      { initialValue: true, message: LOGIN_BROWSER_PROMPT },
    ]);
  });

  it("returns the selected answers and acknowledges the login choice", async () => {
    const { confirmCalls, events, prompts } = createPrompts([false, false]);

    await expect(runClackWizard(prompts)).resolves.toEqual({
      hasBraintrustAccount: false,
      openBrowser: false,
    });

    expect(confirmCalls).toEqual([
      { initialValue: true, message: ACCOUNT_QUESTION },
      { initialValue: true, message: LOGIN_BROWSER_PROMPT },
    ]);
    expect(events).toContain(`outro:${loginPlaceholderOutro(false)}`);
  });

  it("cancels cleanly before completing the flow", async () => {
    const { confirmCalls, events, prompts } = createPrompts([CANCEL]);

    await expect(runClackWizard(prompts)).rejects.toThrow(WizardCancelledError);

    expect(confirmCalls).toEqual([
      { initialValue: true, message: ACCOUNT_QUESTION },
    ]);
    expect(events).toEqual([
      `intro:${WIZARD_TITLE}`,
      `cancel:${WIZARD_CANCEL_MESSAGE}`,
    ]);
  });
});
