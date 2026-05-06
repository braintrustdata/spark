import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DeviceFlowAuthClient } from "../src/auth";
import { BraintrustApiClient } from "../src/braintrust-api";
import {
  type ClackWizardPrompts,
  runClackWizard,
  WizardCancelledError,
  type WizardDeps,
} from "../src/clack-wizard";
import {
  ACCOUNT_QUESTION,
  WIZARD_TITLE,
  WIZARD_CANCEL_MESSAGE,
} from "../src/wizard-copy";

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

function buildDeps(args: {
  readonly prompts: ClackWizardPrompts;
  readonly authClient?: DeviceFlowAuthClient;
  readonly api?: BraintrustApiClient;
  readonly cwd?: string;
}): WizardDeps {
  const cwd = args.cwd ?? mkdtempSync(join(tmpdir(), "bt-wizard-test-"));
  const stubAuth =
    args.authClient ??
    ({
      login: async () => ({ access_token: "tkn", token_type: "Bearer" }),
    } as unknown as DeviceFlowAuthClient);
  const stubApi =
    args.api ??
    ({
      currentUser: async () => ({
        id: "u1",
        email: "alice@example.com",
      }),
      currentUserAwaitingProvisioning: async () => ({
        id: "u1",
        email: "alice@example.com",
      }),
      listOrgs: async () => [{ id: "o1", name: "acme" }],
      listProjects: async () => [{ id: "p1", name: "demo", org_id: "o1" }],
      listApiKeyNames: async () => [],
      createApiKey: async () => ({
        id: "k1",
        name: "alice-created-by-bt-wizard0",
        key: "bt-secret-key",
      }),
      createOrg: async () => ({ id: "o1", existed: false }),
      createProject: async () => ({
        id: "p1",
        name: "demo",
        org_id: "o1",
      }),
    } as unknown as BraintrustApiClient);

  return {
    cwd,
    env: {},
    options: {
      orgName: undefined,
      projectName: undefined,
      apiUrl: "https://api.test",
      appUrl: "https://app.test",
      caCertPath: undefined,
    },
    prompts: args.prompts,
    authClient: stubAuth,
    buildApi: () => stubApi,
    fuzzy: async ({ choices }) => choices[0]!.value,
    openBrowser: async () => true,
  };
}

describe("runClackWizard", () => {
  it("walks through happy path with a single org+project and no harness run", async () => {
    const customProvider = { id: "custom", label: "Custom", custom: true };
    const { prompts, events } = createPrompts({
      confirms: [true],
      selects: ["select", customProvider],
    });
    const deps = buildDeps({ prompts });

    const result = await runClackWizard(deps);

    expect(result.orgName).toBe("acme");
    expect(result.projectName).toBe("demo");
    expect(result.braintrustApiKey).toBe("bt-secret-key");
    expect(events[0]).toBe(`intro:${WIZARD_TITLE}`);
    expect(events).toContain(`confirm:${ACCOUNT_QUESTION}`);
  });

  it("cancels cleanly when the user aborts the account question", async () => {
    const { prompts, events } = createPrompts({ confirms: [CANCEL] });
    const deps = buildDeps({ prompts });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
  });

  it("warns when not in a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bt-wizard-nogit-"));
    mkdirSync(join(dir, "child"), { recursive: true });
    const { prompts, events } = createPrompts({ confirms: [CANCEL] });
    const deps = buildDeps({ prompts, cwd: join(dir, "child") });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events.some((e) => e.startsWith("warn:Heads up"))).toBe(true);
  });

  it("uses --org override and skips the org prompt when the org exists", async () => {
    const customProvider = { id: "custom", label: "Custom", custom: true };
    const { prompts, events } = createPrompts({
      confirms: [true],
      selects: ["select", customProvider],
    });
    const deps: WizardDeps = {
      ...buildDeps({ prompts }),
      options: {
        orgName: "acme",
        projectName: undefined,
        apiUrl: "https://api.test",
        appUrl: "https://app.test",
        caCertPath: undefined,
      },
    };

    const result = await runClackWizard(deps);

    expect(result.orgName).toBe("acme");
    expect(events.some((e) => e === "info:Using --org acme")).toBe(true);
    expect(events.some((e) => e.startsWith("select:Which organization"))).toBe(
      false,
    );
  });

  it("fails when --org is set but the org does not exist", async () => {
    const { prompts } = createPrompts({ confirms: [true] });
    const deps: WizardDeps = {
      ...buildDeps({ prompts }),
      options: {
        orgName: "missing-org",
        projectName: undefined,
        apiUrl: "https://api.test",
        appUrl: "https://app.test",
        caCertPath: undefined,
      },
    };

    await expect(runClackWizard(deps)).rejects.toThrow(
      /Org "missing-org" not found/,
    );
  });

  it("uses --project override and skips the select-or-create prompt", async () => {
    const customProvider = { id: "custom", label: "Custom", custom: true };
    const { prompts, events } = createPrompts({
      confirms: [true],
      selects: [customProvider],
    });
    const deps: WizardDeps = {
      ...buildDeps({ prompts }),
      options: {
        orgName: undefined,
        projectName: "demo",
        apiUrl: "https://api.test",
        appUrl: "https://app.test",
        caCertPath: undefined,
      },
    };

    const result = await runClackWizard(deps);

    expect(result.projectName).toBe("demo");
    expect(events.some((e) => e === "info:Using --project demo")).toBe(true);
    expect(events.some((e) => e.startsWith("select:Use an existing"))).toBe(
      false,
    );
  });

  it("fails when --project is set but the project does not exist in the chosen org", async () => {
    const { prompts } = createPrompts({ confirms: [true] });
    const deps: WizardDeps = {
      ...buildDeps({ prompts }),
      options: {
        orgName: undefined,
        projectName: "missing-project",
        apiUrl: "https://api.test",
        appUrl: "https://app.test",
        caCertPath: undefined,
      },
    };

    await expect(runClackWizard(deps)).rejects.toThrow(
      /Project "missing-project" not found in org "acme"/,
    );
  });
});
