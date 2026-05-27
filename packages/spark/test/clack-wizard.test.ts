import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type WizardSessionCompleteResult,
  type WizardSessionLoginArgs,
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
const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";
const INSTRUMENTATION_MODE_MESSAGE =
  "How do you want to add Braintrust instrumentation?";
const TOOL_SELECT_MESSAGE = "Which coding agent should Braintrust Setup use?";
const OWN_AGENT_DELIVERY_MESSAGE =
  "How should Braintrust Setup deliver the instrumentation prompt?";
const ENV_BRAINTRUST_NOTICE =
  "The wizard will now create a .env.braintrust file that is used to authenticate your application to Braintrust. It will be used for local testing.";

const CANCEL = Symbol("cancel");

type ConfirmAnswer = boolean | typeof CANCEL;
type SelectAnswer =
  | "first"
  | "built-in"
  | "own-agent"
  | "manual"
  | "clipboard"
  | "terminal"
  | "production-done"
  | "production-later"
  | typeof CANCEL;
type TextAnswer = string | typeof CANCEL;

type FakePromptInputs = {
  readonly confirms?: ConfirmAnswer[];
  readonly selects?: readonly SelectAnswer[];
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
    confirm(options) {
      const next = confirms.shift();
      events.push(`confirm:${options.message}`);
      if (next === undefined) {
        throw new Error(`No confirm answer for: ${options.message}`);
      }
      return Promise.resolve(next);
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
    password(options) {
      const next = passwords.shift();
      events.push(`password:${options.message}`);
      if (next === undefined) {
        throw new Error(`No password answer for: ${options.message}`);
      }
      return Promise.resolve(next);
    },
    select<T>(options: {
      readonly message: string;
      readonly options: ReadonlyArray<{
        readonly label: string;
        readonly value: T;
        readonly hint?: string | undefined;
      }>;
    }) {
      const next = selects.shift();
      events.push(`select:${options.message}`);
      if (next === undefined) {
        throw new Error(`No select answer for: ${options.message}`);
      }
      if (next === "first") {
        return Promise.resolve(options.options[0]!.value);
      }
      if (next === "built-in") {
        return Promise.resolve(
          options.options.find(
            (option) => option.label === "Use built-in coding agent",
          )!.value,
        );
      }
      if (next === "own-agent") {
        return Promise.resolve(
          options.options.find(
            (option) => option.label === "Use own coding agent",
          )!.value,
        );
      }
      if (next === "manual") {
        return Promise.resolve(
          options.options.find((option) => option.label === "Set up manually")!
            .value,
        );
      }
      if (
        next === "clipboard" ||
        next === "terminal" ||
        next === "production-done" ||
        next === "production-later"
      ) {
        const value =
          next === "production-done"
            ? "done"
            : next === "production-later"
              ? "later"
              : next;
        const option = options.options.find((option) => option.value === value);
        if (!option) {
          throw new Error(`No select option for: ${next}`);
        }
        return Promise.resolve(option.value);
      }
      return Promise.resolve(next);
    },
    text(options) {
      const next = texts.shift();
      events.push(`text:${options.message}`);
      if (next === undefined) {
        throw new Error(`No text answer for: ${options.message}`);
      }
      return Promise.resolve(next);
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
  readonly writeClipboard?: (text: string) => Promise<void>;
}): WizardDeps {
  const cwd = args.cwd ?? createGitTempDir();
  const stubLogin =
    args.loginWithWizardSession ??
    (async ({ events }: WizardSessionLoginArgs) => {
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
      apiKey: undefined,
      projectId: undefined,
      orgId: undefined,
      projId: undefined,
      yolo: false,
    },
    prompts: args.prompts,
    loginWithWizardSession: stubLogin,
    openBrowser: () => Promise.resolve(true),
    writeClipboard: args.writeClipboard ?? (() => Promise.resolve()),
    codingTools:
      args.codingTools ??
      ({
        discover: () =>
          Promise.resolve([
            {
              id: "claude",
              label: "Claude Code",
              command: "claude",
              installed: true,
              usable: true,
              authMode: "pro",
            },
          ]),
        smokeTest: () =>
          Promise.resolve({
            exitCode: 0,
            signal: null,
            finalText: "BRAINTRUST_SETUP_TOOL_OK",
          }),
        run: ({ env, onEvent, prompt }) => {
          expect(env["BRAINTRUST_API_KEY"]).toBe("bt-secret-key");
          expect(env["BT_WIZARD_RESULT_FILE"]).toBeDefined();
          expect(env["BT_WIZARD_LANGUAGES"]).toBeUndefined();
          expect(prompt).toContain("Unattended mode (YOLO)");
          onEvent({ type: "thinking", message: "Thinking..." });
          onEvent({
            type: "editing",
            message: "Editing package.json",
            target: "package.json",
            toolInput: "file_path: package.json",
            toolName: "Edit",
          });
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            finalText:
              "Instrumentation done\nhttps://www.braintrust.dev/acme/p/demo/logs?r=abc\nINSTRUMENTATION_COMPLETE",
          });
        },
      } satisfies CodingToolRuntime),
  };
}

describe("runClackWizard", () => {
  it("walks through the happy path with one usable coding tool", async () => {
    const { prompts, events } = createPrompts({
      confirms: [true],
      selects: ["first", "first", "production-done"],
    });
    const deps = buildDeps({ prompts });

    const result = await runClackWizard(deps);

    expect(result.orgName).toBe("acme");
    expect(result.projectName).toBe("demo");
    expect(result.braintrustApiKey).toBe("bt-secret-key");
    expect(events[0]).toBe(`intro:${WIZARD_INTRO_TITLE}`);
    expect(events).toContain("note:Setup plan");
    expect(events).toContain(`confirm:${ACCOUNT_QUESTION}`);
    expect(events).toContain(`select:${INSTRUMENTATION_MODE_MESSAGE}`);
    expect(events).toContain(`select:${TOOL_SELECT_MESSAGE}`);
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
    expect(readFileSync(join(deps.cwd, ".env.braintrust"), "utf8")).toBe(
      "BRAINTRUST_API_KEY=bt-secret-key\n",
    );
    expectEnvNoticeBeforeWrite(events);
    expect(
      events.some((event) =>
        event.startsWith("info:Saved instrumentation prompt"),
      ),
    ).toBe(false);
    expect(events).toContain(
      "info:Check your Braintrust logs: https://app.test/acme/p/demo/logs",
    );
  });

  it("passes browser auth mode based on the account answer", async () => {
    const cases = [
      { answer: true, expectedAuthMode: "signin" },
      { answer: false, expectedAuthMode: "signup" },
    ] as const;

    for (const { answer, expectedAuthMode } of cases) {
      let authMode: string | undefined;
      const { prompts } = createPrompts({
        confirms: [answer, true],
        selects: ["manual", "production-done"],
      });
      const deps = buildDeps({
        prompts,
        loginWithWizardSession: async ({ events, loginUrlParams }) => {
          authMode = loginUrlParams?.authMode;
          events.onLoginUrl({
            loginUrl: "https://app.test/app/cli-login?session_token=test",
            expiresAt: "2099-01-01T00:00:00.000Z",
            verificationCode: "123456",
          });
          await events.onTryOpenBrowser(
            "https://app.test/app/cli-login?session_token=test",
          );
          return DEFAULT_LOGIN_RESULT;
        },
      });

      await runClackWizard(deps);
      expect(authMode).toBe(expectedAuthMode);
    }
  });

  it("cancels cleanly when the user aborts the tool select", async () => {
    const { prompts, events } = createPrompts({
      confirms: [true],
      selects: ["first", CANCEL],
    });
    const deps = buildDeps({
      prompts,
      codingTools: {
        discover: () =>
          Promise.resolve([
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
          ]),
        smokeTest: () => Promise.reject(new Error("should not smoke test")),
        run: () => Promise.reject(new Error("should not run")),
      },
    });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
  });

  it("warns when not in a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-nogit-"));
    mkdirSync(join(dir, "child"), { recursive: true });
    const { prompts, events } = createPrompts({
      confirms: [true, true],
      selects: ["first", "first", "production-done"],
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

  it("supports manual instrumentation without creating local env files", async () => {
    const { prompts, events } = createPrompts({
      selects: ["manual", "production-later"],
      confirms: [true, true],
    });
    const deps = buildDeps({ prompts });

    await runClackWizard(deps);
    expect(events).toContain("note:Manual instrumentation");
    expect(events).toContain(`select:${INSTRUMENTATION_MODE_MESSAGE}`);
    expect(events).not.toContain(`select:${TOOL_SELECT_MESSAGE}`);
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
    expect(events).not.toContain(`note.message:${ENV_BRAINTRUST_NOTICE}`);
    expect(existsSync(join(deps.cwd, ".env.braintrust"))).toBe(false);
    expect(existsSync(join(deps.cwd, ".gitignore"))).toBe(false);
  });

  it("copies an interactive prompt for the user's own coding agent", async () => {
    let clipboardText = "";
    const { prompts, events } = createPrompts({
      selects: ["own-agent", "clipboard", "production-done"],
      confirms: [true, true],
    });
    const deps = buildDeps({
      prompts,
      writeClipboard: (text) => {
        clipboardText = text;
        return Promise.resolve();
      },
    });

    await runClackWizard(deps);
    expect(events).toContain(`select:${INSTRUMENTATION_MODE_MESSAGE}`);
    expect(events).toContain(`select:${OWN_AGENT_DELIVERY_MESSAGE}`);
    expect(events).toContain(
      "success:Copied instrumentation prompt to clipboard.",
    );
    expect(events).toContain(
      "confirm:Has your coding agent completed Braintrust instrumentation?",
    );
    expect(events).not.toContain("agent:Claude Code");
    expect(clipboardText).toContain("Interactive mode");
    expect(clipboardText).toContain("Project name to set in code: demo");
    expect(clipboardText).toContain(".env.braintrust");
    expect(clipboardText).not.toContain("This run is non-interactive");
    expectEnvNoticeBeforeWrite(events);
  });

  it("prints an interactive prompt for the user's own coding agent", async () => {
    const { prompts, events } = createPrompts({
      selects: ["own-agent", "terminal", "production-done"],
      confirms: [true, true],
    });
    const deps = buildDeps({ prompts });

    await runClackWizard(deps);
    expect(
      events.some(
        (event) =>
          event.startsWith("message:Braintrust instrumentation prompt:") &&
          event.includes("Interactive mode") &&
          event.includes(
            "https://www.braintrust.dev/docs/instrument/trace-llm-calls",
          ),
      ),
    ).toBe(true);
    expectEnvNoticeBeforeWrite(events);
  });

  it("prints the own-agent prompt when clipboard copy fails", async () => {
    const { prompts, events } = createPrompts({
      selects: ["own-agent", "clipboard", "production-done"],
      confirms: [true, true],
    });
    const deps = buildDeps({
      prompts,
      writeClipboard: () => Promise.reject(new Error("clipboard unavailable")),
    });

    await runClackWizard(deps);
    expect(
      events.some((event) =>
        event.startsWith(
          "warn:Could not copy the instrumentation prompt to the clipboard: clipboard unavailable",
        ),
      ),
    ).toBe(true);
    expect(
      events.some((event) =>
        event.startsWith("message:Braintrust instrumentation prompt:"),
      ),
    ).toBe(true);
  });

  it("fails clearly when the selected tool smoke test fails", async () => {
    const { prompts } = createPrompts({
      confirms: [true],
      selects: ["first", "first"],
    });
    const deps = buildDeps({
      prompts,
      codingTools: {
        discover: () =>
          Promise.resolve([
            {
              id: "claude",
              label: "Claude Code",
              command: "claude",
              installed: true,
              usable: true,
            },
          ]),
        smokeTest: () =>
          Promise.reject(
            new Error("Claude Code could not complete a smoke prompt."),
          ),
        run: () => Promise.reject(new Error("should not run")),
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

function expectEnvNoticeBeforeWrite(events: readonly string[]): void {
  const noticeIndex = events.indexOf(`note.message:${ENV_BRAINTRUST_NOTICE}`);
  const writeIndex = events.findIndex((event) =>
    event.startsWith("success:Wrote "),
  );
  expect(noticeIndex).toBeGreaterThanOrEqual(0);
  expect(writeIndex).toBeGreaterThan(noticeIndex);
}
