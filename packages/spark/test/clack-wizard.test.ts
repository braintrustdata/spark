import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  type WizardSessionCompleteResult,
  type WizardSessionLoginArgs,
  type WizardSessionLogin,
} from "../src/auth";
import {
  type BraintrustCliConfigureArgs,
  type BraintrustCliDiscovery,
  type BraintrustCliContext,
  type BraintrustCliRuntime,
  type BraintrustCliUpdateCheck,
} from "../src/braintrust-cli";
import {
  type CodingToolRuntime,
  runClackWizard,
  WizardCancelledError,
  type WizardDeps,
} from "../src/clack-wizard";

const clackMock = vi.hoisted(() => ({
  cancelSymbol: Symbol("cancel"),
  events: [] as string[],
  selects: [] as unknown[],
  texts: [] as unknown[],
  passwords: [] as unknown[],
}));

vi.mock("@clack/prompts", () => ({
  cancel(message: string) {
    clackMock.events.push(`cancel:${message}`);
  },
  intro(message: string) {
    clackMock.events.push(`intro:${message}`);
  },
  isCancel(value: unknown): value is symbol {
    return value === clackMock.cancelSymbol;
  },
  note(message: string, title?: string) {
    clackMock.events.push(`note:${title ?? ""}`);
    clackMock.events.push(`note.message:${message}`);
  },
  outro(message: string) {
    clackMock.events.push(`outro:${message.split("\n")[0]}`);
  },
  password(options: { readonly message: string }) {
    const next = clackMock.passwords.shift();
    clackMock.events.push(`password:${options.message}`);
    if (next === undefined) {
      throw new Error(`No password answer for: ${options.message}`);
    }
    return Promise.resolve(next);
  },
  select<T>(options: {
    readonly message: string;
    readonly options: ReadonlyArray<{
      readonly label?: string | undefined;
      readonly value: T;
      readonly hint?: string | undefined;
    }>;
  }) {
    const next = clackMock.selects.shift();
    clackMock.events.push(`select:${options.message}`);
    clackMock.events.push(
      `select.options:${options.message}:${options.options.map((option) => option.label).join("|")}`,
    );
    if (next === undefined) {
      throw new Error(`No select answer for: ${options.message}`);
    }
    if (next === "first") {
      return Promise.resolve(options.options[0]!.value);
    }
    if (next === "yes" || next === "no") {
      const value = next === "yes";
      const option = options.options.find((option) => option.value === value);
      if (!option) {
        throw new Error(`No select option for: ${next}`);
      }
      return Promise.resolve(option.value);
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
      next === "proceed" ||
      next === "abort" ||
      next === "confirm" ||
      next === "checked" ||
      next === "confirmed"
    ) {
      const option = options.options.find((option) => option.value === next);
      if (!option) {
        throw new Error(`No select option for: ${next}`);
      }
      return Promise.resolve(option.value);
    }
    return Promise.resolve(next);
  },
  text(options: { readonly message: string }) {
    const next = clackMock.texts.shift();
    clackMock.events.push(`text:${options.message}`);
    if (next === undefined) {
      throw new Error(`No text answer for: ${options.message}`);
    }
    return Promise.resolve(next);
  },
  spinner(options?: {
    readonly indicator?: string;
    readonly withGuide?: boolean;
  }) {
    clackMock.events.push(
      `spinner.create:${options?.indicator ?? "dots"}:${String(options?.withGuide)}`,
    );
    return {
      start(message?: string) {
        clackMock.events.push(`spinner.start:${message ?? ""}`);
      },
      stop(message?: string) {
        clackMock.events.push(`spinner.stop:${message ?? ""}`);
      },
      cancel(message?: string) {
        clackMock.events.push(`spinner.cancel:${message ?? ""}`);
      },
      error(message?: string) {
        clackMock.events.push(`spinner.error:${message ?? ""}`);
      },
      message(message?: string) {
        clackMock.events.push(`spinner.message:${message ?? ""}`);
      },
      clear() {
        clackMock.events.push("spinner.clear");
      },
      isCancelled: false,
    };
  },
  taskLog(options: {
    readonly title: string;
    readonly spacing?: number;
    readonly retainLog?: boolean;
  }) {
    clackMock.events.push(
      `taskLog:${options.title}:${String(options.spacing)}:${String(options.retainLog)}`,
    );
    return {
      message(message: string) {
        clackMock.events.push(`taskLog.message:${message}`);
      },
      error(message: string) {
        clackMock.events.push(`taskLog.error:${message}`);
      },
      success(message: string) {
        clackMock.events.push(`taskLog.success:${message}`);
      },
    };
  },
  log: {
    warn: (message: string) => clackMock.events.push(`warn:${message}`),
    info: (message: string) => clackMock.events.push(`info:${message}`),
    error: (message: string) => clackMock.events.push(`error:${message}`),
    success: (message: string) => clackMock.events.push(`success:${message}`),
    message: (message: string) => clackMock.events.push(`message:${message}`),
  },
}));

const WIZARD_INTRO = "Braintrust Setup Wizard";
const WIZARD_CANCEL_MESSAGE = [
  "Wizard cancelled.",
  "",
  "If you ran into an issue, please open a GitHub issue: https://github.com/braintrustdata/spark/issues/new",
  "",
  "- Contact support: https://www.braintrust.dev/contact",
  "- Further documentation: https://www.braintrust.dev/docs/instrument",
].join("\n");
const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";
const INSTRUMENTATION_MODE_MESSAGE =
  "How do you want to add Braintrust to your application?";
const CLI_INSTALL_MESSAGE = "Install Braintrust CLI?";
const CLI_UPDATE_MESSAGE = "Update Braintrust CLI to the latest version?";
const TOOL_SELECT_MESSAGE = "Which coding agent should Braintrust Setup use?";
const CODING_AGENT_PROCEED_MESSAGE =
  "This setup wizard will now invoke a coding agent with full permissions. Proceed?";
const CODING_AGENT_SCAN_MESSAGE = "Searching for available coding agents...";
const OWN_AGENT_DELIVERY_MESSAGE =
  "How do you want to receive the prompt for your coding agent?";
const OWN_AGENT_COMPLETED_MESSAGE =
  "Paste the above prompt into your coding agent. Press enter and proceed when the agent has completed the task.";
const MANUAL_INSTRUMENTATION_MESSAGE =
  "Follow the Braintrust instrumentation docs for your project:";
const TRACE_LOGS_CHECK_MESSAGE =
  "Your application should now be instrumented with Braintrust tracing.";
const PRODUCTION_TOKEN_MESSAGE = "Production Setup: Add the";
const DIRTY_REPOSITORY_MESSAGE = "Git changes detected.";
const GENERATED_FILE_COMMENT =
  "This file was generated by the Braintrust wizard. This file contains sensitive information. Do not commit this file to version control! The file can be safely deleted after confirming your application sends traces.";
const ENV_BRAINTRUST_FILE_CONTENT = `# ${GENERATED_FILE_COMMENT}\nBRAINTRUST_API_KEY=bt-secret-key\n`;
const BRAINTRUST_JSON_FILE_CONTENT = `${JSON.stringify(
  {
    "//": GENERATED_FILE_COMMENT,
    BRAINTRUST_API_KEY: "bt-secret-key",
  },
  null,
  2,
)}\n`;
const LOCAL_TOKEN_GITIGNORE_CONTENT =
  "# Added by Braintrust Wizard\n.env.braintrust\n.braintrust.json\n";

const CANCEL = clackMock.cancelSymbol;
const stdoutWriteSpy = vi.spyOn(process.stdout, "write");

type SelectAnswer =
  | "first"
  | "yes"
  | "no"
  | "built-in"
  | "own-agent"
  | "manual"
  | "clipboard"
  | "terminal"
  | "proceed"
  | "abort"
  | "confirm"
  | "checked"
  | "confirmed"
  | typeof CANCEL;
type TextAnswer = string | typeof CANCEL;

type FakePromptInputs = {
  readonly selects?: readonly SelectAnswer[];
  readonly texts?: TextAnswer[];
  readonly passwords?: TextAnswer[];
};

function createPrompts(inputs: FakePromptInputs) {
  const events: string[] = [];
  clackMock.events = events;
  clackMock.selects = [...(inputs.selects ?? [])];
  clackMock.texts = [...(inputs.texts ?? [])];
  clackMock.passwords = [...(inputs.passwords ?? [])];
  stdoutWriteSpy.mockImplementation(
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      const message =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      events.push(`writeRaw:${message}`);
      const done =
        typeof encodingOrCallback === "function"
          ? encodingOrCallback
          : callback;
      done?.();
      return true;
    },
  );

  return { events };
}

const DEFAULT_LOGIN_RESULT: WizardSessionCompleteResult = {
  apiKey: "bt-secret-key",
  orgId: "o1",
  orgName: "acme",
  projectId: "p1",
  projectName: "demo",
};

function buildDeps(
  args: {
    readonly loginWithWizardSession?: WizardSessionLogin;
    readonly cwd?: string;
    readonly codingTools?: CodingToolRuntime;
    readonly braintrustCli?: BraintrustCliRuntime;
    readonly writeClipboard?: (text: string) => Promise<void>;
    readonly options?: Partial<WizardDeps["options"]>;
  } = {},
): WizardDeps {
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
      ...args.options,
    },
    loginWithWizardSession: stubLogin,
    openBrowser: () => Promise.resolve(true),
    writeClipboard: args.writeClipboard ?? (() => Promise.resolve()),
    braintrustCli: args.braintrustCli ?? createBraintrustCliStub(),
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
          expect(prompt).toContain(
            "Set up Braintrust tracing in this working directory.",
          );
          expect(prompt).toContain(
            'Set the project name in the SDK initialization to "demo".',
          );
          expect(prompt).toContain(
            "Do not run application code, and do not break or meaningfully modify existing code.",
          );
          expect(prompt).toContain("Do not use the Braintrust CLI (`bt`).");
          expect(prompt).not.toContain("Unattended mode (YOLO)");
          onEvent({
            type: "reading",
            message: "Reading package.json",
            target: "package.json",
            toolInput: "file_path: package.json",
            toolName: "Read",
          });
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

function createBraintrustCliStub(
  args: {
    readonly discoveries?: readonly BraintrustCliDiscovery[];
    readonly install?: () => Promise<void>;
    readonly checkForUpdate?: (
      commandPath: string,
    ) => Promise<BraintrustCliUpdateCheck>;
    readonly update?: (commandPath: string) => Promise<void>;
    readonly status?: (commandPath: string) => Promise<BraintrustCliContext>;
    readonly loginAndSwitch?: (
      commandPath: string,
      args: BraintrustCliConfigureArgs,
    ) => Promise<void>;
  } = {},
): BraintrustCliRuntime {
  let discoveryIndex = 0;
  const discoveries = args.discoveries ?? [{ installed: false }];

  return {
    discover: () => {
      const discovery =
        discoveries[Math.min(discoveryIndex, discoveries.length - 1)]!;
      discoveryIndex += 1;
      return Promise.resolve(discovery);
    },
    install: args.install ?? (() => Promise.resolve()),
    checkForUpdate:
      args.checkForUpdate ?? (() => Promise.resolve({ upToDate: false })),
    update: args.update ?? (() => Promise.resolve()),
    status: args.status ?? (() => Promise.resolve({})),
    loginAndSwitch: args.loginAndSwitch ?? (() => Promise.resolve()),
  };
}

describe("runClackWizard", () => {
  it("walks through the happy path with one usable coding tool", async () => {
    const { events } = createPrompts({
      selects: ["yes", "no", "first", "proceed", "checked", "confirmed"],
    });
    const deps = buildDeps();

    const result = await runClackWizard(deps);

    expect(result.orgName).toBe("acme");
    expect(result.projectName).toBe("demo");
    expect(result.braintrustApiKey).toBe("bt-secret-key");
    expect(events[0]).toBe("writeRaw:\n");
    expect(events[1]).toBe(`intro:${WIZARD_INTRO}`);
    expect(events).not.toContain("note:Setup plan");
    expect(events).toContain(`select:${ACCOUNT_QUESTION}`);
    expect(events).toContain(`select:${CLI_INSTALL_MESSAGE}`);
    expect(events).toContain(`select:${INSTRUMENTATION_MODE_MESSAGE}`);
    expect(events).not.toContain(`select:${TOOL_SELECT_MESSAGE}`);
    expect(events).toContain(`spinner.start:${CODING_AGENT_SCAN_MESSAGE}`);
    const codingAgentSpinnerStart = events.indexOf(
      `spinner.start:${CODING_AGENT_SCAN_MESSAGE}`,
    );
    const instrumentationModePrompt = events.indexOf(
      `select:${INSTRUMENTATION_MODE_MESSAGE}`,
    );
    const codingAgentSpinnerClear = events.findIndex(
      (event, index) =>
        index > codingAgentSpinnerStart && event === "spinner.clear",
    );
    expect(codingAgentSpinnerStart).toBeGreaterThanOrEqual(0);
    expect(codingAgentSpinnerClear).toBeGreaterThan(codingAgentSpinnerStart);
    expect(codingAgentSpinnerStart).toBeLessThan(instrumentationModePrompt);
    expect(codingAgentSpinnerClear).toBeLessThan(instrumentationModePrompt);
    expect(events).toContain(`select:${CODING_AGENT_PROCEED_MESSAGE}`);
    expect(
      events.some((event) => event.startsWith("spinner.create:timer:")),
    ).toBe(true);
    expect(events).not.toContain(
      "spinner.start:Checking Claude Code can run...",
    );
    expect(
      events.some(
        (event) =>
          event.includes(
            "Sign in to continue the setup. Your browser should have opened automatically.",
          ) &&
          event.includes("https://app.test/app/cli-login?session_token=test"),
      ),
    ).toBe(true);
    expect(
      events.some((event) =>
        event.includes(
          "If your browser didn't open automatically, open the link below to sign in:",
        ),
      ),
    ).toBe(true);
    expect(events).toContain(
      "spinner.start:Waiting for you to sign in via the browser...",
    );
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
    expect(events).toContain(
      "taskLog:Running Claude Code to instrument your application:0:false",
    );
    expect(events).toContain("taskLog.message:read: package.json");
    expect(events).not.toContain("taskLog.message:thinking");
    expect(events).toContain("taskLog.message:write: package.json");
    expect(events).toContain("taskLog.success:Instrumentation complete.");
    expect(readFileSync(join(deps.cwd, ".env.braintrust"), "utf8")).toBe(
      ENV_BRAINTRUST_FILE_CONTENT,
    );
    expect(readFileSync(join(deps.cwd, ".braintrust.json"), "utf8")).toBe(
      BRAINTRUST_JSON_FILE_CONTENT,
    );
    expect(events).not.toContain(
      "success:Wrote .env.braintrust and .braintrust.json",
    );
    expect(
      events.some(
        (event) =>
          event.startsWith(`select:${TRACE_LOGS_CHECK_MESSAGE}`) &&
          event.includes(
            "Please run your app locally now, and invoke AI functionality to confirm whether AI calls are logged and traced.",
          ) &&
          event.includes("https://app.test/app/acme/p/demo/logs"),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.startsWith(`select:${PRODUCTION_TOKEN_MESSAGE}`) &&
          event.includes("BRAINTRUST_API_KEY") &&
          event.includes("./.env.braintrust"),
      ),
    ).toBe(true);
    expect(events).not.toContain("note:Local application token");
    expect(
      events.some((event) =>
        event.startsWith("info:Saved instrumentation prompt"),
      ),
    ).toBe(false);
    expect(
      events.some((event) =>
        event.startsWith("info:Check your Braintrust logs"),
      ),
    ).toBe(false);
  });

  it("preflights available coding agents before asking for instrumentation mode", async () => {
    const calls: string[] = [];
    let activeSmokeTests = 0;
    let maxActiveSmokeTests = 0;
    const { events } = createPrompts({
      selects: [
        "yes",
        "no",
        "built-in",
        "first",
        "proceed",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({
      codingTools: {
        discover: () => {
          calls.push("discover");
          return Promise.resolve([
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
          ]);
        },
        smokeTest: async ({ id }) => {
          calls.push(`smoke:${id}`);
          activeSmokeTests += 1;
          maxActiveSmokeTests = Math.max(maxActiveSmokeTests, activeSmokeTests);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          activeSmokeTests -= 1;
          return {
            exitCode: 0,
            signal: null,
            finalText: "BRAINTRUST_SETUP_TOOL_OK",
          };
        },
        run: ({ onEvent }) => {
          onEvent({ type: "completed", message: "Done" });
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            finalText: "INSTRUMENTATION_COMPLETE",
          });
        },
      },
    });

    await runClackWizard(deps);

    expect(calls.slice(0, 3)).toEqual([
      "discover",
      "smoke:claude",
      "smoke:codex",
    ]);
    expect(maxActiveSmokeTests).toBe(2);
    expect(events).toContain(`select:${TOOL_SELECT_MESSAGE}`);
    const codingAgentSpinnerStart = events.indexOf(
      `spinner.start:${CODING_AGENT_SCAN_MESSAGE}`,
    );
    const instrumentationModePrompt = events.indexOf(
      `select:${INSTRUMENTATION_MODE_MESSAGE}`,
    );
    const codingAgentSpinnerClear = events.findIndex(
      (event, index) =>
        index > codingAgentSpinnerStart && event === "spinner.clear",
    );
    expect(codingAgentSpinnerStart).toBeGreaterThanOrEqual(0);
    expect(codingAgentSpinnerClear).toBeGreaterThan(codingAgentSpinnerStart);
    expect(codingAgentSpinnerStart).toBeLessThan(instrumentationModePrompt);
    expect(codingAgentSpinnerClear).toBeLessThan(instrumentationModePrompt);
  });

  it("uses compact task log spacing for built-in coding agent output", async () => {
    const { events } = createPrompts({
      selects: ["yes", "no", "first", "proceed", "checked", "confirmed"],
    });
    const deps = buildDeps();

    await runClackWizard(deps);

    expect(events).toContain(
      "taskLog:Running Claude Code to instrument your application:0:false",
    );
    expect(events).toContain("taskLog.message:read: package.json");
    expect(events).not.toContain("taskLog.message:thinking");
    expect(events).toContain("taskLog.message:write: package.json");
    expect(events).toContain("taskLog.success:Instrumentation complete.");
  });

  it("does not start the delayed coding agent spinner after a fast run", async () => {
    const { events } = createPrompts({
      selects: ["yes", "no", "first", "proceed", "checked", "confirmed"],
    });
    const deps = buildDeps();

    await runClackWizard(deps);
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    expect(events).not.toContain(
      "spinner.start:Checking Claude Code can run...",
    );
  });

  it("passes browser auth mode based on the account answer", async () => {
    const cases = [
      { answer: true, expectedAuthMode: "signin" },
      { answer: false, expectedAuthMode: "signup" },
    ] as const;

    for (const { answer, expectedAuthMode } of cases) {
      let authMode: string | undefined;
      createPrompts({
        selects: [
          answer ? "yes" : "no",
          "no",
          "manual",
          "confirm",
          "checked",
          "confirmed",
        ],
      });
      const deps = buildDeps({
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

  it("skips the account question when browser org and project ids are provided", async () => {
    let loginUrlParams: WizardSessionLoginArgs["loginUrlParams"];
    const { events } = createPrompts({
      selects: ["no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      options: { orgId: "org-123", projId: "proj-456" },
      loginWithWizardSession: async ({ events, loginUrlParams: params }) => {
        loginUrlParams = params;
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

    expect(events).not.toContain(`select:${ACCOUNT_QUESTION}`);
    expect(loginUrlParams).toEqual({
      orgId: "org-123",
      projectId: "proj-456",
      authMode: "signin",
    });
  });

  it("overwrites existing local token files without prompting", async () => {
    const cwd = createGitTempDir();
    const envFilePath = join(cwd, ".env.braintrust");
    writeFileSync(envFilePath, "BRAINTRUST_API_KEY=old\n");
    const { events } = createPrompts({
      selects: [
        "yes",
        "yes",
        "no",
        "manual",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({ cwd });

    await runClackWizard(deps);

    expect(
      events.some((event) =>
        event.startsWith("select:Replace local Braintrust token files?"),
      ),
    ).toBe(false);
    expect(readFileSync(envFilePath, "utf8")).toBe(ENV_BRAINTRUST_FILE_CONTENT);
    expect(readFileSync(join(cwd, ".braintrust.json"), "utf8")).toBe(
      BRAINTRUST_JSON_FILE_CONTENT,
    );
  });

  it("writes local token files in the cwd instead of the git root", async () => {
    const root = createGitTempDir();
    const cwd = join(root, "app", "service");
    mkdirSync(cwd, { recursive: true });
    createPrompts({
      selects: ["yes", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({ cwd });

    await runClackWizard(deps);

    expect(readFileSync(join(cwd, ".env.braintrust"), "utf8")).toBe(
      ENV_BRAINTRUST_FILE_CONTENT,
    );
    expect(readFileSync(join(cwd, ".braintrust.json"), "utf8")).toBe(
      BRAINTRUST_JSON_FILE_CONTENT,
    );
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(
      LOCAL_TOKEN_GITIGNORE_CONTENT,
    );
    expect(existsSync(join(root, ".env.braintrust"))).toBe(false);
    expect(existsSync(join(root, ".braintrust.json"))).toBe(false);
    expect(existsSync(join(root, ".gitignore"))).toBe(false);
  });

  it("does not print a gitignore message when local token files are already covered", async () => {
    const cwd = createGitTempDir();
    writeFileSync(
      join(cwd, ".gitignore"),
      ".env.braintrust\n.braintrust.json\n",
    );
    const { events } = createPrompts({
      selects: [
        "yes",
        "yes",
        "no",
        "manual",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({ cwd });

    await runClackWizard(deps);

    expect(events).not.toContain(
      "info:Updated .gitignore for local Braintrust token files.",
    );
    expect(events).not.toContain(
      "info:.gitignore already covers local Braintrust token files.",
    );
    expect(events).not.toContain("info:.gitignore unchanged.");
  });

  it("installs and configures the Braintrust CLI when missing and accepted", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "yes", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: false },
          {
            installed: true,
            commandPath: "/usr/local/bin/bt",
            version: "bt 0.10.0",
          },
        ],
        install: () => {
          calls.push("install");
          return Promise.resolve();
        },
        status: (commandPath) => {
          calls.push(`status:${commandPath}`);
          return Promise.resolve({});
        },
        loginAndSwitch: (commandPath, args) => {
          calls.push(
            `login:${commandPath}:${args.apiKey}:${args.apiUrl}:${args.appUrl}:${args.orgName}:${args.projectName}`,
          );
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).toContain(`select:${CLI_INSTALL_MESSAGE}`);
    expect(events).toContain("spinner.start:Installing Braintrust CLI...");
    expect(events).toContain(
      "spinner.message:Checking Braintrust CLI login state...",
    );
    expect(events).toContain(`spinner.message:${CODING_AGENT_SCAN_MESSAGE}`);
    expect(events).toContain("spinner.clear");
    expect(events).not.toContain("spinner.stop:Installed Braintrust CLI.");
    expect(events).not.toContain("success:Configured Braintrust CLI.");
    expect(events).not.toContain(
      "spinner.message:Configuring Braintrust CLI login state...",
    );
    expect(events).not.toContain(`spinner.start:${CODING_AGENT_SCAN_MESSAGE}`);
    expect(
      events.indexOf("spinner.message:Checking Braintrust CLI login state..."),
    ).toBeLessThan(events.indexOf(`select:${INSTRUMENTATION_MODE_MESSAGE}`));
    expect(calls).toEqual([
      "install",
      "status:/usr/local/bin/bt",
      "login:/usr/local/bin/bt:bt-secret-key:https://api.test:https://app.test:acme:demo",
    ]);
  });

  it("skips Braintrust CLI install and configuration when declined", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        install: () => {
          calls.push("install");
          return Promise.resolve();
        },
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).toContain(`select:${CLI_INSTALL_MESSAGE}`);
    expect(events).toContain(`select:${INSTRUMENTATION_MODE_MESSAGE}`);
    expect(calls).toEqual([]);
  });

  it("continues when Braintrust CLI install fails", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "yes", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        install: () => Promise.reject(new Error("install failed")),
        status: () => {
          calls.push("status");
          return Promise.resolve({});
        },
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).toContain("spinner.start:Installing Braintrust CLI...");
    expect(events).toContain("spinner.clear");
    expect(events).not.toContain(
      "spinner.stop:Braintrust CLI install stopped.",
    );
    expect(
      events.some((event) =>
        event.startsWith(
          "warn:Could not install Braintrust CLI: install failed",
        ),
      ),
    ).toBe(true);
    expect(events).toContain(`select:${INSTRUMENTATION_MODE_MESSAGE}`);
    expect(calls).toEqual([]);
  });

  it("skips the update question when the Braintrust CLI is already up to date", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        checkForUpdate: (commandPath) => {
          calls.push(`check:${commandPath}`);
          return Promise.resolve({ upToDate: true });
        },
        update: (commandPath) => {
          calls.push(`update:${commandPath}`);
          return Promise.resolve();
        },
        status: () => {
          calls.push("status");
          return Promise.resolve({});
        },
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).not.toContain(`select:${CLI_UPDATE_MESSAGE}`);
    expect(events).not.toContain("spinner.start:Updating Braintrust CLI...");
    expect(
      events.some((event) => event.includes("Braintrust CLI is up to date")),
    ).toBe(false);
    expect(calls).toEqual(["check:/bin/bt", "status", "login"]);
  });

  it("updates when the update check fails and the user accepts", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["no", "yes", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        checkForUpdate: () => Promise.reject(new Error("network down")),
        update: (commandPath) => {
          calls.push(`update:${commandPath}`);
          return Promise.resolve();
        },
        status: () => {
          calls.push("status");
          return Promise.resolve({});
        },
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(
      events.some((event) =>
        event.includes("Could not check for Braintrust CLI updates"),
      ),
    ).toBe(false);
    expect(events).toContain(`select:${CLI_UPDATE_MESSAGE}`);
    expect(calls).toEqual(["update:/bin/bt", "status", "login"]);
  });

  it("updates and configures an installed Braintrust CLI when accepted", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "yes", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.1" },
        ],
        update: (commandPath) => {
          calls.push(`update:${commandPath}`);
          return Promise.resolve();
        },
        status: (commandPath) => {
          calls.push(`status:${commandPath}`);
          return Promise.resolve({});
        },
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).toContain(`select:${CLI_UPDATE_MESSAGE}`);
    expect(events).toContain("spinner.start:Updating Braintrust CLI...");
    expect(events).toContain(
      "spinner.message:Checking Braintrust CLI login state...",
    );
    expect(events).toContain(`spinner.message:${CODING_AGENT_SCAN_MESSAGE}`);
    expect(events).toContain("spinner.clear");
    expect(events).not.toContain("spinner.stop:Updated Braintrust CLI.");
    expect(events).not.toContain("success:Configured Braintrust CLI.");
    expect(events).not.toContain(
      "spinner.message:Configuring Braintrust CLI login state...",
    );
    expect(events).not.toContain(`spinner.start:${CODING_AGENT_SCAN_MESSAGE}`);
    expect(calls).toEqual(["update:/bin/bt", "status:/bin/bt", "login"]);
  });

  it("still configures an installed Braintrust CLI when update fails", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "yes", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        update: () => Promise.reject(new Error("update failed")),
        status: () => {
          calls.push("status");
          return Promise.resolve({});
        },
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).toContain("spinner.start:Updating Braintrust CLI...");
    expect(events).toContain("spinner.clear");
    expect(events).not.toContain("spinner.stop:Braintrust CLI update stopped.");
    expect(
      events.some((event) =>
        event.startsWith("warn:Could not update Braintrust CLI: update failed"),
      ),
    ).toBe(true);
    expect(calls).toEqual(["status", "login"]);
  });

  it("configures an installed Braintrust CLI with matching context without asking to switch", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        status: () =>
          Promise.resolve({ profile: "acme", org: "acme", project: "demo" }),
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).toContain(`select:${CLI_UPDATE_MESSAGE}`);
    expect(
      events.some((event) =>
        event.startsWith("select:Switch Braintrust CLI login profile from"),
      ),
    ).toBe(false);
    expect(events).toContain(
      "spinner.start:Checking Braintrust CLI login state...",
    );
    expect(events).not.toContain(
      "spinner.message:Configuring Braintrust CLI login state...",
    );
    expect(calls).toEqual(["login"]);
  });

  it("does not ask to switch Braintrust CLI context when the current CLI status is incomplete", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        status: () => Promise.resolve({ org: "other", project: "old" }),
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(
      events.some((event) =>
        event.startsWith("select:Switch Braintrust CLI login profile from"),
      ),
    ).toBe(false);
    expect(calls).toEqual(["login"]);
  });

  it("defaults to switching a different active Braintrust CLI context", async () => {
    const calls: string[] = [];
    createPrompts({
      selects: [
        "yes",
        "no",
        "first",
        "manual",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        status: () =>
          Promise.resolve({ profile: "work", org: "other", project: "old" }),
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(calls).toEqual(["login"]);
  });

  it("leaves a different Braintrust CLI context untouched when switch is declined", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "no", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        status: () =>
          Promise.resolve({ profile: "work", org: "other", project: "old" }),
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(events).toContain(
      "select:Switch Braintrust CLI login profile from work (other/old) to acme (acme/demo)?",
    );
    expect(events).not.toContain(
      "info:Leaving existing Braintrust CLI context unchanged.",
    );
    expect(calls).toEqual([]);
  });

  it("switches a different Braintrust CLI context when accepted", async () => {
    const calls: string[] = [];
    let finishSwitch!: () => void;
    const switchDone = new Promise<void>((resolve) => {
      finishSwitch = resolve;
    });
    const { events } = createPrompts({
      selects: [
        "yes",
        "no",
        "yes",
        "manual",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        status: () =>
          Promise.resolve({ profile: "work", org: "other", project: "old" }),
        loginAndSwitch: () => {
          calls.push("login");
          return switchDone;
        },
      }),
      codingTools: {
        discover: () => {
          calls.push("discover-coding-tools");
          return Promise.resolve([
            {
              id: "claude",
              label: "Claude Code",
              command: "claude",
              installed: true,
              usable: true,
              authMode: "pro",
            },
          ]);
        },
        smokeTest: () =>
          Promise.resolve({
            exitCode: 0,
            signal: null,
            finalText: "BRAINTRUST_SETUP_TOOL_OK",
          }),
        run: () =>
          Promise.resolve({
            exitCode: 0,
            signal: null,
            finalText: "BRAINTRUST_SETUP_TOOL_OK",
          }),
      },
    });

    let runComplete = false;
    const runPromise = runClackWizard(deps).then(() => {
      runComplete = true;
    });
    await vi.waitFor(() => {
      expect(calls).toEqual(["login", "discover-coding-tools"]);
      expect(events).toContain(
        "select:How do you want to add Braintrust to your application?",
      );
    });
    expect(runComplete).toBe(false);

    finishSwitch();
    await runPromise;

    expect(runComplete).toBe(true);
    expect(calls).toEqual(["login", "discover-coding-tools"]);
    expect(events).not.toContain(
      "spinner.start:Configuring Braintrust CLI login state...",
    );
    expect(events).toContain(`spinner.start:${CODING_AGENT_SCAN_MESSAGE}`);
  });

  it("does not configure the Braintrust CLI when status inspection fails", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
      braintrustCli: createBraintrustCliStub({
        discoveries: [
          { installed: true, commandPath: "/bin/bt", version: "bt 0.10.0" },
        ],
        status: () => Promise.reject(new Error("status failed")),
        loginAndSwitch: () => {
          calls.push("login");
          return Promise.resolve();
        },
      }),
    });

    await runClackWizard(deps);

    expect(
      events.some((event) =>
        event.startsWith(
          "warn:Could not inspect Braintrust CLI status; leaving existing CLI context unchanged. status failed",
        ),
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  it("cancels cleanly when the user aborts the tool select", async () => {
    const smokeCalls: string[] = [];
    const { events } = createPrompts({
      selects: ["yes", "no", "first", CANCEL],
    });
    const deps = buildDeps({
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
        smokeTest: ({ id }) => {
          smokeCalls.push(id);
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            finalText: "BRAINTRUST_SETUP_TOOL_OK",
          });
        },
        run: () => Promise.reject(new Error("should not run")),
      },
    });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
    expect(smokeCalls).toEqual(["claude", "codex"]);
  });

  it("offers own-agent and manual setup when built-in coding agent execution is aborted", async () => {
    const calls: string[] = [];
    const { events } = createPrompts({
      selects: [
        "yes",
        "no",
        "built-in",
        "abort",
        "own-agent",
        "terminal",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({
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
        smokeTest: () => {
          calls.push("smoke");
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            finalText: "BRAINTRUST_SETUP_TOOL_OK",
          });
        },
        run: () => {
          calls.push("run");
          return Promise.reject(new Error("should not run"));
        },
      },
    });

    await runClackWizard(deps);

    expect(events).toContain(`select:${CODING_AGENT_PROCEED_MESSAGE}`);
    expect(
      events.filter(
        (event) => event === `select:${INSTRUMENTATION_MODE_MESSAGE}`,
      ),
    ).toHaveLength(2);
    expect(events).toContain(`select:${OWN_AGENT_DELIVERY_MESSAGE}`);
    expect(events).not.toContain(
      "taskLog:Running Claude Code to instrument your application:0:false",
    );
    expect(calls).toEqual(["smoke"]);
  });

  it("asks before continuing when not in a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-nogit-"));
    mkdirSync(join(dir, "child"), { recursive: true });
    const { events } = createPrompts({
      selects: ["yes", "yes", "no", "first", "first", "checked", "confirmed"],
    });
    const deps = buildDeps({ cwd: join(dir, "child") });

    await runClackWizard(deps);
    expect(
      events.some(
        (event) =>
          event.startsWith("select:") &&
          event.includes("not a git repository") &&
          event.includes("Continue without a git repository?"),
      ),
    ).toBe(true);
  });

  it("cancels when the user does not continue outside a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-nogit-"));
    const { events } = createPrompts({ selects: ["no"] });
    const deps = buildDeps({ cwd: dir });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(
      events.some(
        (event) =>
          event.startsWith("select:") &&
          event.includes("not a git repository") &&
          event.includes("Continue without a git repository?"),
      ),
    ).toBe(true);
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
  });

  it("asks before continuing with uncommitted or untracked files", async () => {
    const cwd = createGitTempDir();
    writeFileSync(join(cwd, "existing-work.ts"), "changed\n");
    const { events } = createPrompts({
      selects: [
        "yes",
        "yes",
        "no",
        "manual",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({ cwd });

    await runClackWizard(deps);

    expect(
      events.some(
        (event) =>
          event.startsWith("select:") &&
          event.includes(DIRTY_REPOSITORY_MESSAGE) &&
          event.includes("1. existing-work.ts") &&
          event.includes("Continue?"),
      ),
    ).toBe(true);
    expect(events.indexOf(`select:${ACCOUNT_QUESTION}`)).toBeGreaterThan(
      events.findIndex((event) => event.includes(DIRTY_REPOSITORY_MESSAGE)),
    );
  });

  it("cancels when the user does not continue with dirty repo files", async () => {
    const cwd = createGitTempDir();
    writeFileSync(join(cwd, "existing-work.ts"), "changed\n");
    const { events } = createPrompts({ selects: ["no"] });
    const deps = buildDeps({ cwd });

    await expect(runClackWizard(deps)).rejects.toThrow(WizardCancelledError);
    expect(
      events.some(
        (event) =>
          event.startsWith("select:") &&
          event.includes(DIRTY_REPOSITORY_MESSAGE) &&
          event.includes("1. existing-work.ts") &&
          event.includes("Continue?"),
      ),
    ).toBe(true);
    expect(events).toContain(`cancel:${WIZARD_CANCEL_MESSAGE}`);
  });

  it("supports manual instrumentation after creating local token files", async () => {
    const { events } = createPrompts({
      selects: ["yes", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps();

    await runClackWizard(deps);
    expect(events).not.toContain("note:Manual instrumentation");
    expect(events).toContain(`select:${INSTRUMENTATION_MODE_MESSAGE}`);
    expect(events).not.toContain(`select:${TOOL_SELECT_MESSAGE}`);
    expect(
      events.some((event) =>
        event.includes(
          "https://www.braintrust.dev/docs/instrument/trace-llm-calls",
        ),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.startsWith(`select:${MANUAL_INSTRUMENTATION_MESSAGE}`) &&
          event.includes(
            "Did you complete setting up Braintrust by following the docs?",
          ),
      ),
    ).toBe(true);
    expect(events).not.toContain(
      "warn:Do not forget to add BRAINTRUST_API_KEY to production. Braintrust tracing will not work in production without it.",
    );
    expect(events).not.toContain("note:Local application token");
    expect(readFileSync(join(deps.cwd, ".env.braintrust"), "utf8")).toBe(
      ENV_BRAINTRUST_FILE_CONTENT,
    );
    expect(readFileSync(join(deps.cwd, ".braintrust.json"), "utf8")).toBe(
      BRAINTRUST_JSON_FILE_CONTENT,
    );
    expect(existsSync(join(deps.cwd, ".gitignore"))).toBe(true);
  });

  it("copies an interactive prompt for the user's own coding agent", async () => {
    let clipboardText = "";
    const { events } = createPrompts({
      selects: [
        "yes",
        "no",
        "own-agent",
        "clipboard",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({
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
    expect(events).toContain(`select:${OWN_AGENT_COMPLETED_MESSAGE}`);
    expect(events).toContain(
      `select.options:${OWN_AGENT_COMPLETED_MESSAGE}:Confirm and proceed`,
    );
    expect(events).not.toContain(
      "taskLog:Running Claude Code to instrument your application:0:false",
    );
    expect(clipboardText).toContain(
      "Set up Braintrust tracing in this working directory.",
    );
    expect(clipboardText).toContain(
      'Set the project name in the SDK initialization to "demo".',
    );
    expect(clipboardText).toContain(".env.braintrust");
    expect(clipboardText).toContain(".braintrust.json");
    expect(clipboardText).toContain("Do not use the Braintrust CLI (`bt`).");
    expect(clipboardText).not.toContain("Interactive mode");
  });

  it("prints an interactive prompt for the user's own coding agent", async () => {
    const { events } = createPrompts({
      selects: [
        "yes",
        "no",
        "own-agent",
        "terminal",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps();

    await runClackWizard(deps);
    expect(
      events.some(
        (event) =>
          event.startsWith("writeRaw:") &&
          !event.includes("Braintrust instrumentation prompt:") &&
          event.includes("https://www.braintrust.dev/docs/llms.txt") &&
          event.includes(
            'Set the project name in the SDK initialization to "demo".',
          ),
      ),
    ).toBe(true);
  });

  it("prints the own-agent prompt when clipboard copy fails", async () => {
    const { events } = createPrompts({
      selects: [
        "yes",
        "no",
        "own-agent",
        "clipboard",
        "confirm",
        "checked",
        "confirmed",
      ],
    });
    const deps = buildDeps({
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
      events.some(
        (event) =>
          event.startsWith("writeRaw:") &&
          !event.includes("Braintrust instrumentation prompt:") &&
          event.includes("https://www.braintrust.dev/docs/llms.txt"),
      ),
    ).toBe(true);
  });

  it("omits built-in setup when preflight smoke tests fail", async () => {
    const { events } = createPrompts({
      selects: ["yes", "no", "manual", "confirm", "checked", "confirmed"],
    });
    const deps = buildDeps({
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

    await runClackWizard(deps);

    expect(events).toContain(`spinner.start:${CODING_AGENT_SCAN_MESSAGE}`);
    expect(events).toContain(
      `select.options:${INSTRUMENTATION_MODE_MESSAGE}:Use own coding agent|Set up manually`,
    );
    expect(
      events.some(
        (event) =>
          event.startsWith("warn:No usable coding agents found.") &&
          event.includes("Claude Code could not complete a smoke prompt."),
      ),
    ).toBe(true);
    expect(events).not.toContain(`select:${CODING_AGENT_PROCEED_MESSAGE}`);
  });
});

function createGitTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  return dir;
}
