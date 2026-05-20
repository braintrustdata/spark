import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type WizardSessionAuthClient,
  type WizardSessionCompleteResult,
  type WizardSessionEvents,
} from "../src/auth";
import {
  type ClackWizardPrompts,
  runClackWizard,
  WizardCancelledError,
  type WizardDeps,
} from "../src/clack-wizard";
import { WIZARD_TITLE, WIZARD_CANCEL_MESSAGE } from "../src/wizard-copy";

const CANCEL = Symbol("cancel");

type ConfirmAnswer = boolean | typeof CANCEL;
type SelectAnswer<T> = T | typeof CANCEL;
type TextAnswer = string | typeof CANCEL;

type FakePromptInputs = {
  readonly confirms?: ConfirmAnswer[];
  readonly selects?: ReadonlyArray<unknown>;
  readonly texts?: TextAnswer[];
  readonly passwords?: TextAnswer[];
};

function createPrompts(inputs: FakePromptInputs) {
  const events: string[] = [];
  const confirms = [...(inputs.confirms ?? [])];
  const selects = [...(inputs.selects ?? [])];
  const texts = [...(inputs.texts ?? [])];
  const passwords = [...(inputs.passwords ?? [])];

  const prompts: ClackWizardPrompts = {
    cancel(message) {
      events.push(`cancel:${message}`);
    },
    async confirm(options) {
      const next = confirms.shift();
      events.push(`confirm:${options.message}`);
      if (next === undefined) {
        throw new Error(`No confirm answer for: ${options.message}`);
      }
      return next;
    },
    intro(message) {
      events.push(`intro:${message}`);
    },
    isCancel(value): value is symbol {
      return value === CANCEL;
    },
    note(message, title) {
      events.push(`note:${title ?? ""}`);
      void message;
    },
    outro(message) {
      events.push(`outro:${message.split("\n")[0]}`);
    },
    async password(options) {
      const next = passwords.shift();
      events.push(`password:${options.message}`);
      if (next === undefined) {
        throw new Error(`No password answer for: ${options.message}`);
      }
      return next as string | symbol;
    },
    async select(options) {
      const next = selects.shift();
      events.push(`select:${options.message}`);
      if (next === undefined) {
        throw new Error(`No select answer for: ${options.message}`);
      }
      return next as SelectAnswer<unknown> as symbol;
    },
    async text(options) {
      const next = texts.shift();
      events.push(`text:${options.message}`);
      if (next === undefined) {
        throw new Error(`No text answer for: ${options.message}`);
      }
      return next as string | symbol;
    },
    log: {
      warn: (m) => events.push(`warn:${m}`),
      info: (m) => events.push(`info:${m}`),
      error: (m) => events.push(`error:${m}`),
      success: (m) => events.push(`success:${m}`),
    },
  };

  return { prompts, events };
}

const DEFAULT_LOGIN_RESULT: WizardSessionCompleteResult = {
  apiKey: "bt-secret-key",
  orgId: "o1",
  orgName: "acme",
  projectId: "p1",
  projectName: "demo",
};

function buildDeps(args: {
  readonly prompts: ClackWizardPrompts;
  readonly authClient?: WizardSessionAuthClient;
  readonly cwd?: string;
}): WizardDeps {
  const cwd = args.cwd ?? mkdtempSync(join(tmpdir(), "spark-test-"));
  const stubAuth =
    args.authClient ??
    ({
      login: async (events: WizardSessionEvents) => {
        events.onLoginUrl({
          loginUrl: "https://app.test/app/cli-login?session_token=test",
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
        await events.onTryOpenBrowser(
          "https://app.test/app/cli-login?session_token=test",
        );
        return DEFAULT_LOGIN_RESULT;
      },
    } as unknown as WizardSessionAuthClient);

  return {
    cwd,
    env: {},
    options: {
      apiUrl: "https://api.test",
      appUrl: "https://app.test",
      caCertPath: undefined,
      apiKey: undefined,
      projectId: undefined,
      instrument: false,
      yolo: false,
      provider: undefined,
      providerApiKey: undefined,
    },
    prompts: args.prompts,
    authClient: stubAuth,
    openBrowser: async () => true,
  };
}

describe("runClackWizard", () => {
  it("walks through happy path with no harness run", async () => {
    const customProvider = { id: "custom", label: "Custom", custom: true };
    const { prompts, events } = createPrompts({
      selects: [customProvider],
    });
    const deps = buildDeps({ prompts });

    const result = await runClackWizard(deps);

    expect(result.orgName).toBe("acme");
    expect(result.projectName).toBe("demo");
    expect(result.braintrustApiKey).toBe("bt-secret-key");
    expect(events[0]).toBe(`intro:${WIZARD_TITLE}`);
    expect(events).toContain("note:Login");
  });

  it("cancels cleanly when the user aborts the provider select", async () => {
    const { prompts, events } = createPrompts({ selects: [CANCEL] });
    const deps = buildDeps({ prompts });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
  });

  it("warns when not in a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spark-nogit-"));
    mkdirSync(join(dir, "child"), { recursive: true });
    const { prompts, events } = createPrompts({ selects: [CANCEL] });
    const deps = buildDeps({ prompts, cwd: join(dir, "child") });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events.some((e) => e.startsWith("warn:Heads up"))).toBe(true);
  });

  it("treats empty password submissions as skipped credentials", async () => {
    const anthropicProvider = {
      id: "anthropic",
      label: "Anthropic",
      envVar: "ANTHROPIC_API_KEY",
    };
    const { prompts, events } = createPrompts({
      selects: [anthropicProvider],
      passwords: [""],
    });
    const deps = buildDeps({ prompts });

    const result = await runClackWizard(deps);

    expect(result.orgName).toBe("acme");
    expect(events).toContain(
      "warn:No credentials entered; skipping instrumentation.",
    );
  });
});
