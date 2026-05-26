import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type WizardSessionCompleteResult,
  type WizardSessionEvents,
  type WizardSessionLogin,
} from "../src/auth";
import {
  type CodingToolRuntime,
  type ClackWizardPrompts,
  runClackWizard,
  WizardCancelledError,
  type WizardDeps,
} from "../src/clack-wizard";

const WIZARD_INTRO_TITLE = "Welcome to the Braintrust setup wizard";
const WIZARD_CANCEL_MESSAGE = "Wizard cancelled.";
const TOOL_SELECT_MESSAGE = "Which coding agent should Braintrust Setup use?";
const PRODUCTION_TOKEN_MESSAGE =
  "Have you added BRAINTRUST_API_KEY to your deployment platform?";

const CANCEL = Symbol("cancel");

type ConfirmAnswer = boolean | typeof CANCEL;
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
      events.push(`note.message:${message}`);
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
      if (next === "first") {
        return options.options[0]!.value as symbol;
      }
      if (next === "manual") {
        return options.options.find(
          (option) => option.label === "Manually instrument",
        )!.value as symbol;
      }
      if (next === "production-done") {
        return "done" as unknown as symbol;
      }
      if (next === "production-later") {
        return "later" as unknown as symbol;
      }
      return next as symbol;
    },
    async text(options) {
      const next = texts.shift();
      events.push(`text:${options.message}`);
      if (next === undefined) {
        throw new Error(`No text answer for: ${options.message}`);
      }
      return next as string | symbol;
    },
    spinner() {
      return {
        start(message) {
          events.push(`spinner.start:${message ?? ""}`);
        },
        stop(message) {
          events.push(`spinner.stop:${message ?? ""}`);
        },
      };
    },
    codingAgentOutput(options) {
      events.push(`agent:${options.toolLabel}`);
      return {
        event(event) {
          events.push(
            `agent.event:${event.type}:${event.toolName ?? event.message}:${event.toolInput ?? ""}`,
          );
        },
        fail(message) {
          events.push(`agent.error:${message}`);
        },
        success(message) {
          events.push(`agent.success:${message}`);
        },
      };
    },
    log: {
      warn: (m) => events.push(`warn:${m}`),
      info: (m) => events.push(`info:${m}`),
      error: (m) => events.push(`error:${m}`),
      success: (m) => events.push(`success:${m}`),
      message: (m) => events.push(`message:${m}`),
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
  readonly loginWithWizardSession?: WizardSessionLogin;
  readonly cwd?: string;
  readonly codingTools?: CodingToolRuntime;
  readonly tool?: "claude" | "codex";
}): WizardDeps {
  const cwd = args.cwd ?? createGitTempDir();
  const stubLogin =
    args.loginWithWizardSession ??
    (async (events: WizardSessionEvents) => {
      events.onLoginUrl({
        loginUrl: "https://app.test/app/cli-login?session_token=test",
        expiresAt: "2099-01-01T00:00:00.000Z",
        verificationCode: "123456",
      });
      await events.onTryOpenBrowser(
        "https://app.test/app/cli-login?session_token=test",
      );
      return DEFAULT_LOGIN_RESULT;
    });

  return {
    cwd,
    env: {},
    options: {
      apiUrl: "https://api.test",
      appUrl: "https://app.test",
      caCertPath: undefined,
      apiKey: undefined,
      projectId: undefined,
      yolo: false,
      tool: args.tool,
    },
    prompts: args.prompts,
    loginWithWizardSession: stubLogin,
    openBrowser: async () => true,
    codingTools:
      args.codingTools ??
      ({
        discover: async () => [
          {
            id: "claude",
            label: "Claude Code",
            command: "claude",
            installed: true,
            usable: true,
            authMode: "pro",
          },
        ],
        smokeTest: async () => ({
          exitCode: 0,
          signal: null,
          finalText: "BRAINTRUST_SETUP_TOOL_OK",
        }),
        run: async ({ env, onEvent }) => {
          expect(env["BRAINTRUST_API_KEY"]).toBe("bt-secret-key");
          expect(env["BT_WIZARD_RESULT_FILE"]).toBeDefined();
          expect(env["BT_WIZARD_LANGUAGES"]).toBeUndefined();
          onEvent({ type: "thinking", message: "Thinking..." });
          onEvent({
            type: "editing",
            message: "Editing package.json",
            target: "package.json",
            toolInput: "file_path: package.json",
            toolName: "Edit",
          });
          return {
            exitCode: 0,
            signal: null,
            finalText:
              "Instrumentation done\nhttps://www.braintrust.dev/acme/p/demo/logs?r=abc\nINSTRUMENTATION_COMPLETE",
          };
        },
      } satisfies CodingToolRuntime),
  };
}

describe("runClackWizard", () => {
  it("walks through the happy path with one usable coding tool", async () => {
    const { prompts, events } = createPrompts({
      selects: ["first", "production-done"],
    });
    const deps = buildDeps({ prompts });

    const result = await runClackWizard(deps);

    expect(result.orgName).toBe("acme");
    expect(result.projectName).toBe("demo");
    expect(result.braintrustApiKey).toBe("bt-secret-key");
    expect(events[0]).toBe(`intro:${WIZARD_INTRO_TITLE}`);
    expect(events).toContain("note:Setup plan");
    expect(events.some((event) => event.startsWith("info:Sign in:"))).toBe(
      true,
    );
    expect(
      events.some((event) =>
        event.includes(
          "If your browser didn't open automatically, open the link above to sign in.",
        ),
      ),
    ).toBe(true);
    expect(events).toContain("spinner.start:Waiting for login in browser...");
    expect(
      events.some((event) =>
        event.startsWith("spinner.stop:Browser setup complete."),
      ),
    ).toBe(true);
    expect(
      events.some((event) =>
        event.startsWith("success:Browser setup complete"),
      ),
    ).toBe(false);
    expect(events).toContain("agent:Claude Code");
    expect(events).toContain(
      "agent.event:editing:Edit:file_path: package.json",
    );
    expect(events).toContain("agent.success:Instrumentation complete.");
    expect(
      events.some((event) =>
        event.startsWith("info:Saved instrumentation prompt"),
      ),
    ).toBe(false);
    expect(events).toContain(
      "info:Check your Braintrust logs: https://app.test/acme/p/demo/logs",
    );
  });

  it("cancels cleanly when the user aborts the tool select", async () => {
    const { prompts, events } = createPrompts({ selects: [CANCEL] });
    const deps = buildDeps({
      prompts,
      codingTools: {
        discover: async () => [
          {
            id: "claude",
            label: "Claude Code",
            command: "claude",
            installed: true,
            usable: true,
          },
          {
            id: "codex",
            label: "Codex",
            command: "codex",
            installed: true,
            usable: true,
          },
        ],
        smokeTest: async () => {
          throw new Error("should not smoke test");
        },
        run: async () => {
          throw new Error("should not run");
        },
      },
    });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
  });

  it("warns when not in a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-nogit-"));
    mkdirSync(join(dir, "child"), { recursive: true });
    const { prompts, events } = createPrompts({
      confirms: [true],
      selects: ["first", "production-done"],
    });
    const deps = buildDeps({ prompts, cwd: join(dir, "child") });

    await runClackWizard(deps);
    expect(events.some((e) => e.startsWith("warn:Heads up"))).toBe(true);
    expect(events).toContain("confirm:Continue without a git repository?");
  });

  it("cancels when the user does not continue outside a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-nogit-"));
    const { prompts, events } = createPrompts({ confirms: [false] });
    const deps = buildDeps({ prompts, cwd: dir });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events).toContain("confirm:Continue without a git repository?");
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
  });

  it("supports manual instrumentation when no coding tool is usable", async () => {
    const { prompts, events } = createPrompts({
      selects: ["manual", "production-later"],
      confirms: [true],
    });
    const deps = buildDeps({
      prompts,
      codingTools: {
        discover: async () => [
          {
            id: "claude",
            label: "Claude Code",
            command: "claude",
            installed: false,
            usable: false,
            unavailableReason: "claude was not found on PATH.",
          },
          {
            id: "codex",
            label: "Codex",
            command: "codex",
            installed: true,
            usable: false,
            unavailableReason: "Codex is not logged in.",
          },
        ],
        smokeTest: async () => {
          throw new Error("should not smoke test");
        },
        run: async () => {
          throw new Error("should not run");
        },
      },
    });

    await runClackWizard(deps);
    expect(events).toContain("note:Manual instrumentation");
    expect(
      events.some((event) =>
        event.includes(
          "https://www.braintrust.dev/docs/instrument/trace-llm-calls",
        ),
      ),
    ).toBe(true);
    expect(events).toContain(
      "confirm:Have you completed the Braintrust instrumentation docs?",
    );
    expect(events).toContain(
      "warn:Do not forget to add BRAINTRUST_API_KEY to production. Braintrust tracing will not work in production without it.",
    );
  });

  it("uses a configured coding tool without prompting", async () => {
    const { prompts, events } = createPrompts({
      selects: ["production-done"],
    });
    const deps = buildDeps({
      prompts,
      tool: "codex",
      codingTools: {
        discover: async () => [
          {
            id: "claude",
            label: "Claude Code",
            command: "claude",
            installed: true,
            usable: true,
          },
          {
            id: "codex",
            label: "Codex",
            command: "codex",
            installed: true,
            usable: true,
          },
        ],
        smokeTest: async ({ id }) => ({
          exitCode: 0,
          signal: null,
          finalText: id === "codex" ? "BRAINTRUST_SETUP_TOOL_OK" : "wrong tool",
        }),
        run: async ({ id }) => ({
          exitCode: 0,
          signal: null,
          finalText: `${id}\nINSTRUMENTATION_COMPLETE`,
        }),
      },
    });

    await runClackWizard(deps);
    expect(events).not.toContain(`select:${TOOL_SELECT_MESSAGE}`);
    expect(events).toContain(`select:${PRODUCTION_TOKEN_MESSAGE}`);
    expect(events).toContain("info:Using Codex for instrumentation.");
  });

  it("fails clearly when the selected tool smoke test fails", async () => {
    const { prompts } = createPrompts({ selects: ["first"] });
    const deps = buildDeps({
      prompts,
      codingTools: {
        discover: async () => [
          {
            id: "claude",
            label: "Claude Code",
            command: "claude",
            installed: true,
            usable: true,
          },
        ],
        smokeTest: async () => {
          throw new Error("Claude Code could not complete a smoke prompt.");
        },
        run: async () => {
          throw new Error("should not run");
        },
      },
    });

    await expect(runClackWizard(deps)).rejects.toThrow(
      /could not complete a smoke prompt/,
    );
  });
});

function createGitTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  return dir;
}
