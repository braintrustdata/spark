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
  WIZARD_SIGNIN_COMPLETE_MESSAGE,
  WIZARD_SIGNIN_LINK_TITLE,
  WIZARD_SIGNIN_RESULT_TITLE,
  WIZARD_TITLE,
} from "../src/wizard-copy";
import {
  type WizardSigninClient,
  type WizardSigninPollResult,
  type WizardSigninSession,
} from "../src/wizard-signin-client";

const CANCEL = Symbol("cancel");
const SIGNIN_SESSION: WizardSigninSession = {
  expiresAt: "2026-05-06T21:15:00.000Z",
  id: "session-id",
  loginPath: "/app/cli-login/session-id",
  loginUrl: "https://braintrust.test/app/cli-login/session-id",
  pollToken: "poll-token",
};

const COMPLETE_RESULT = {
  apiKey: "sk-test-api-key",
  orgInfo: {
    id: "org-id",
    name: "Acme",
  },
  project: {
    id: "project-id",
    name: "Demo",
  },
  status: "complete",
} satisfies WizardSigninPollResult;

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
    log: {
      warn(message) {
        events.push(`warn:${message}`);
      },
    },
    note(message, title) {
      events.push(`note:${title ?? ""}:${message ?? ""}`);
    },
    outro(message) {
      events.push(`outro:${message}`);
    },
    spinner() {
      return {
        error(message) {
          events.push(`spinner.error:${message ?? ""}`);
        },
        message(message) {
          events.push(`spinner.message:${message ?? ""}`);
        },
        start(message) {
          events.push(`spinner.start:${message ?? ""}`);
        },
        stop(message) {
          events.push(`spinner.stop:${message ?? ""}`);
        },
      };
    },
  };

  return {
    confirmCalls,
    events,
    prompts,
  };
}

function createSigninClient(
  pollResults: WizardSigninPollResult[] = [COMPLETE_RESULT],
) {
  const calls: string[] = [];
  const client: WizardSigninClient = {
    backendUrl: "https://braintrust.test",
    async createSigninSession() {
      calls.push("create");
      return SIGNIN_SESSION;
    },
    async pollSigninSession(session) {
      calls.push(`poll:${session.id}`);
      const result = pollResults.shift();

      if (!result) {
        throw new Error("No fake poll result was provided.");
      }

      return result;
    },
  };

  return {
    calls,
    client,
  };
}

describe("runClackWizard", () => {
  it("asks both questions in order and completes the browser sign-in flow", async () => {
    const { confirmCalls, events, prompts } = createPrompts([true, true]);
    const { calls, client } = createSigninClient();
    const openedUrls: string[] = [];

    await expect(
      runClackWizard(prompts, {
        client,
        openUrl: async (url) => {
          openedUrls.push(url);
        },
      }),
    ).resolves.toEqual({
      apiKey: COMPLETE_RESULT.apiKey,
      backendUrl: "https://braintrust.test",
      hasBraintrustAccount: true,
      openBrowser: true,
      org: COMPLETE_RESULT.orgInfo,
      project: COMPLETE_RESULT.project,
    });

    expect(calls).toEqual(["create", "poll:session-id"]);
    expect(openedUrls).toEqual([`${SIGNIN_SESSION.loginUrl}?auth=signin`]);
    expect(events).toEqual([
      `intro:${WIZARD_TITLE}`,
      "spinner.start:Creating Braintrust sign-in session...",
      "spinner.stop:Created Braintrust sign-in session.",
      expect.stringContaining(`note:${WIZARD_SIGNIN_LINK_TITLE}:`),
      "spinner.start:Waiting for browser sign-in to finish...",
      "spinner.stop:Braintrust sign-in complete.",
      expect.stringContaining(`note:${WIZARD_SIGNIN_RESULT_TITLE}:`),
      `outro:${WIZARD_SIGNIN_COMPLETE_MESSAGE}`,
    ]);
    expect(confirmCalls).toEqual([
      { initialValue: true, message: ACCOUNT_QUESTION },
      { initialValue: true, message: LOGIN_BROWSER_PROMPT },
    ]);
  });

  it("shows the link without opening a browser when browser opening is skipped", async () => {
    const { confirmCalls, events, prompts } = createPrompts([false, false]);
    const { calls, client } = createSigninClient();
    const openedUrls: string[] = [];

    await expect(
      runClackWizard(prompts, {
        client,
        openUrl: async (url) => {
          openedUrls.push(url);
        },
      }),
    ).resolves.toEqual({
      apiKey: COMPLETE_RESULT.apiKey,
      backendUrl: "https://braintrust.test",
      hasBraintrustAccount: false,
      openBrowser: false,
      org: COMPLETE_RESULT.orgInfo,
      project: COMPLETE_RESULT.project,
    });

    expect(calls).toEqual(["create", "poll:session-id"]);
    expect(openedUrls).toEqual([]);
    expect(confirmCalls).toEqual([
      { initialValue: true, message: ACCOUNT_QUESTION },
      { initialValue: true, message: LOGIN_BROWSER_PROMPT },
    ]);
    expect(events).toContain(`outro:${WIZARD_SIGNIN_COMPLETE_MESSAGE}`);
    expect(events).toContainEqual(
      expect.stringContaining(`${SIGNIN_SESSION.loginUrl}?auth=signup`),
    );
    expect(events).toContainEqual(
      expect.stringContaining(COMPLETE_RESULT.apiKey),
    );
  });

  it("cancels cleanly before completing the flow", async () => {
    const { confirmCalls, events, prompts } = createPrompts([CANCEL]);
    const { calls, client } = createSigninClient();

    await expect(runClackWizard(prompts, { client })).rejects.toThrow(
      WizardCancelledError,
    );

    expect(calls).toEqual([]);
    expect(confirmCalls).toEqual([
      { initialValue: true, message: ACCOUNT_QUESTION },
    ]);
    expect(events).toEqual([
      `intro:${WIZARD_TITLE}`,
      `cancel:${WIZARD_CANCEL_MESSAGE}`,
    ]);
  });
});
