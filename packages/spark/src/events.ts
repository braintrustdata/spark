import { existsSync } from "node:fs";

import pkg from "../package.json" with { type: "json" };
import type { WizardSessionCreateResponse } from "./auth";
import { DEFAULT_APP_URL, type WizardOptions } from "./options";
import {
  CLI_SETUP_DOCS_PAGES,
  type CliSetupAgentMarker,
  type CliSetupAuthMode,
  type CliSetupClientContext,
  type CliSetupDocsPage,
  type CliSetupEntryPoint,
} from "./setup-events-contract";

export type {
  CliSetupAuthMode,
  CliSetupAgentMarker,
  CliSetupClientContext,
  CliSetupDocsPage,
  CliSetupEntryPoint,
};

export type CliSetupInstrumentationMode = "built_in" | "own_agent" | "manual";

export type CliSetupStepName =
  | "repository_preflight"
  | "authentication"
  | "credentials_write"
  | "bt_cli_setup"
  | "coding_tool_preflight"
  | "instrumentation_selection"
  | "coding_tool_confirmation"
  | "instrumentation_run"
  | "trace_verification"
  | "production_setup";

export type CliSetupStepOutcome =
  | "started"
  | "completed"
  | "skipped"
  | "failed"
  | "cancelled";

export type CliSetupFailureCategory =
  | "network"
  | "auth"
  | "permission"
  | "unsupported_platform"
  | "repository_state"
  | "filesystem"
  | "bt_cli"
  | "coding_tool_unavailable"
  | "coding_tool_failed"
  | "trace_not_observed"
  | "cancelled"
  | "unknown";

export type CliSetupReasonCode =
  | "repository_dirty_declined"
  | "repository_not_git_declined"
  | "user_interrupt"
  | "browser_auth_failed"
  | "browser_auth_timed_out"
  | "credentials_write_failed"
  | "bt_cli_install_declined"
  | "bt_cli_context_switch_declined"
  | "bt_cli_install_failed"
  | "bt_cli_status_failed"
  | "no_usable_coding_tool"
  | "built_in_instrumentation_declined"
  | "coding_tool_nonzero_exit"
  | "coding_tool_reported_incomplete"
  | "coding_tool_exception"
  | "trace_check_cancelled"
  | "production_setup_cancelled"
  | "unknown";

export type CliSetupRepositoryState = "clean" | "dirty" | "not_git";
export type CliSetupRepositoryDecision = "continue" | "cancel" | "not_required";

export type CliSetupCodingToolUnavailableReasonCode =
  | "not_detected"
  | "not_authenticated"
  | "status_check_failed"
  | "smoke_test_failed"
  | "unknown";

export type CliSetupCodingToolResult = {
  readonly toolId: "claude" | "codex";
  readonly detected: boolean;
  readonly usable: boolean;
  readonly unavailableReasonCode?:
    | CliSetupCodingToolUnavailableReasonCode
    | undefined;
};

export type CliSetupInstrumentationResult =
  | "completed_with_marker"
  | "completed_without_marker"
  | "reported_incomplete"
  | "nonzero_exit"
  | "exception"
  | "user_cancellation";

export type WizardEventStep = {
  readonly id: string;
  readonly name: CliSetupStepName;
};

export type WizardEventInstrumentation = {
  readonly mode: CliSetupInstrumentationMode;
  readonly codingTool?: string | undefined;
};

type WizardStepFinishArgs = {
  readonly failureCategory?: CliSetupFailureCategory | undefined;
  readonly instrumentation?: WizardEventInstrumentation | undefined;
  readonly reasonCode?: CliSetupReasonCode | undefined;
  readonly repositoryState?: CliSetupRepositoryState | undefined;
  readonly repositoryDecision?: CliSetupRepositoryDecision | undefined;
  readonly codingToolResults?: readonly CliSetupCodingToolResult[] | undefined;
  readonly instrumentationResult?: CliSetupInstrumentationResult | undefined;
  readonly verificationMethod?: "self_reported" | undefined;
};

type WizardTerminationArgs = {
  readonly outcome: "completed" | "cancelled" | "failed";
  readonly failureCategory?: CliSetupFailureCategory | undefined;
  readonly reasonCode?: CliSetupReasonCode | undefined;
};

export type WizardEventsRuntime = {
  readonly start: () => Promise<WizardSessionCreateResponse | undefined>;
  readonly setAuthMode: (authMode: CliSetupAuthMode) => void;
  readonly setInstrumentation: (args: WizardEventInstrumentation) => void;
  readonly startStep: (
    name: CliSetupStepName,
    args?: {
      readonly failureCategory?: CliSetupFailureCategory | undefined;
    },
  ) => WizardEventStep;
  readonly finishStep: (
    step: WizardEventStep,
    outcome: Exclude<CliSetupStepOutcome, "started">,
    args?: WizardStepFinishArgs,
  ) => void;
  readonly terminate: (args: WizardTerminationArgs) => Promise<void>;
};

type ActiveStep = WizardEventStep & {
  readonly startedAtMs: number;
  readonly stepSequence: number;
  readonly defaultFailureCategory: CliSetupFailureCategory | undefined;
  readonly instrumentationMode: CliSetupInstrumentationMode | undefined;
  readonly codingTool: string | undefined;
};

type StepEventPropertiesBase = {
  readonly step: CliSetupStepName;
  readonly stepSequence: number;
  readonly clientEventSequence?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly instrumentationMode?: CliSetupInstrumentationMode | undefined;
  readonly codingTool?: string | undefined;
  readonly repositoryState?: CliSetupRepositoryState | undefined;
  readonly repositoryDecision?: CliSetupRepositoryDecision | undefined;
  readonly codingToolResults?: readonly CliSetupCodingToolResult[] | undefined;
  readonly instrumentationResult?: CliSetupInstrumentationResult | undefined;
  readonly verificationMethod?: "self_reported" | undefined;
};

type StepEventProperties =
  | (StepEventPropertiesBase & {
      readonly outcome: "started" | "completed" | "skipped";
      readonly reasonCode?: CliSetupReasonCode | undefined;
    })
  | (StepEventPropertiesBase & {
      readonly outcome: "failed" | "cancelled";
      readonly failureCategory: CliSetupFailureCategory;
      readonly reasonCode?: CliSetupReasonCode | undefined;
    });

type TerminatedEventPropertiesBase = {
  readonly clientEventSequence?: number | undefined;
  readonly currentStep?: CliSetupStepName | undefined;
  readonly durationMs: number;
  readonly instrumentationMode?: CliSetupInstrumentationMode | undefined;
  readonly codingTool?: string | undefined;
};

type TerminatedEventProperties =
  | (TerminatedEventPropertiesBase & {
      readonly outcome: "completed";
    })
  | (TerminatedEventPropertiesBase & {
      readonly outcome: "failed" | "cancelled";
      readonly failureCategory: CliSetupFailureCategory;
      readonly reasonCode?: CliSetupReasonCode | undefined;
    });

type SetupEventRequest =
  | {
      readonly occurredAt: string;
      readonly clientContext: CliSetupClientContext;
      readonly event: "cliSetupStep";
      readonly properties: StepEventProperties;
    }
  | {
      readonly occurredAt: string;
      readonly clientContext: CliSetupClientContext;
      readonly event: "cliSetupTerminated";
      readonly properties: TerminatedEventProperties;
    };

const EVENT_REQUEST_TIMEOUT_MS = 1_500;
const FINAL_FLUSH_TIMEOUT_MS = 5_000;

const DOCS_SOURCE_PREFIX = "docs_";

const DECLARED_AGENT_MARKERS = {
  amp: "amp",
  antigravity: "antigravity",
  "augment-cli": "augment",
  augment: "augment",
  claude: "claude_code",
  "claude-code": "claude_code",
  codex: "codex",
  cursor: "cursor",
  "cursor-cli": "cursor",
  devin: "devin",
  gemini: "gemini_cli",
  "gemini-cli": "gemini_cli",
  "github-copilot": "github_copilot",
  "github-copilot-cli": "github_copilot",
  github_copilot_vscode_agent: "github_copilot",
  goose: "goose",
  opencode: "opencode",
  replit: "replit",
} as const satisfies Record<string, CliSetupAgentMarker>;

const FALSY_AGENT_MARKERS = new Set(["0", "false", "no", "off"]);

export function setupAttribution(args: {
  readonly from?: string | undefined;
}): Pick<CliSetupClientContext, "entryPoint" | "docsPage"> {
  if (args.from === "homepage") return { entryPoint: "homepage" };
  if (args.from === "in_app_onboarding") {
    return { entryPoint: "in_app_onboarding" };
  }
  if (args.from === "in_app_setup") return { entryPoint: "in_app_setup" };
  if (args.from?.startsWith(DOCS_SOURCE_PREFIX)) {
    const sourcePage = args.from.slice(DOCS_SOURCE_PREFIX.length);
    const docsPage = CLI_SETUP_DOCS_PAGES.find(
      (candidate) => candidate === sourcePage,
    );
    if (docsPage !== undefined) {
      return {
        entryPoint: "docs",
        docsPage,
      };
    }
  }
  return { entryPoint: "direct" };
}

export function buildCliSetupClientContext(
  options: WizardOptions,
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): CliSetupClientContext {
  const ci = options.apiKey !== undefined && options.projectId !== undefined;
  const declaredAiAgent = env["AI_AGENT"]?.trim().toLowerCase();
  let agentMarker: CliSetupAgentMarker | undefined =
    declaredAiAgent && !FALSY_AGENT_MARKERS.has(declaredAiAgent)
      ? (DECLARED_AGENT_MARKERS[
          declaredAiAgent as keyof typeof DECLARED_AGENT_MARKERS
        ] ?? "other")
      : undefined;
  if (
    agentMarker === undefined &&
    (env["CODEX_THREAD_ID"] || env["CODEX_CI"] || env["CODEX_SANDBOX"])
  ) {
    agentMarker = "codex";
  } else if (
    agentMarker === undefined &&
    (env["CLAUDECODE"] || env["CLAUDE_CODE"] || env["CLAUDE_CODE_ENTRYPOINT"])
  ) {
    agentMarker = "claude_code";
  } else if (
    agentMarker === undefined &&
    (env["CURSOR_AGENT"] ||
      env["CURSOR_TRACE_ID"] ||
      env["CURSOR_EXTENSION_HOST_ROLE"] === "agent-exec")
  ) {
    agentMarker = "cursor";
  } else if (agentMarker === undefined && env["GEMINI_CLI"]) {
    agentMarker = "gemini_cli";
  } else if (
    agentMarker === undefined &&
    (env["OPENCODE"] || env["OPENCODE_CLIENT"])
  ) {
    agentMarker = "opencode";
  } else if (
    agentMarker === undefined &&
    (env["VSCODE_AGENT"] ||
      env["COPILOT_MODEL"] ||
      env["COPILOT_ALLOW_ALL"] ||
      env["COPILOT_GITHUB_TOKEN"])
  ) {
    agentMarker = "github_copilot";
  } else if (agentMarker === undefined && env["GOOSE_TERMINAL"]) {
    agentMarker = "goose";
  } else if (agentMarker === undefined && env["ANTIGRAVITY_AGENT"]) {
    agentMarker = "antigravity";
  } else if (agentMarker === undefined && env["AUGMENT_AGENT"]) {
    agentMarker = "augment";
  } else if (agentMarker === undefined && env["REPL_ID"]) {
    agentMarker = "replit";
  }
  const declaredAgent = env["AGENT"]?.trim().toLowerCase();
  if (
    agentMarker === undefined &&
    declaredAgent &&
    !FALSY_AGENT_MARKERS.has(declaredAgent)
  ) {
    agentMarker =
      DECLARED_AGENT_MARKERS[
        declaredAgent as keyof typeof DECLARED_AGENT_MARKERS
      ] ?? "other";
  }
  if (agentMarker === undefined && pathExists("/opt/.devin")) {
    agentMarker = "devin";
  }
  return {
    cliVersion: pkg.version,
    platform: process.platform,
    architecture: process.arch,
    ...setupAttribution({ from: options.from }),
    ...(ci ? { authMode: "ci" as const } : {}),
    ...(agentMarker === undefined ? {} : { agentMarker }),
  };
}

export function createWizardEvents(args: {
  readonly clientContext: CliSetupClientContext;
  readonly createSession: (
    clientContext: CliSetupClientContext,
    signal: AbortSignal,
  ) => Promise<WizardSessionCreateResponse>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
}): WizardEventsRuntime {
  const fetchRequest = args.fetch ?? globalThis.fetch;
  const now = args.now ?? (() => new Date());
  const monotonicNow = args.monotonicNow ?? (() => performance.now());
  const startedAtMs = monotonicNow();
  const clientContext: {
    current: CliSetupClientContext;
  } = { current: args.clientContext };
  const instrumentation: {
    mode: CliSetupInstrumentationMode | undefined;
    codingTool: string | undefined;
  } = { mode: undefined, codingTool: undefined };
  const activeSteps = new Map<string, ActiveStep>();
  const pending = new Set<Promise<void>>();
  const sessionAbortController = new AbortController();
  let sessionPromise: Promise<WizardSessionCreateResponse | undefined>;
  let terminationPromise: Promise<void> | undefined;
  let started = false;
  let lastStepSequence = 0;
  let lastClientEventSequence = 0;

  function start(): Promise<WizardSessionCreateResponse | undefined> {
    if (!started) {
      started = true;
      sessionPromise = args
        .createSession(clientContext.current, sessionAbortController.signal)
        .catch(() => undefined);
    }
    return sessionPromise!;
  }

  function contextSnapshot(): CliSetupClientContext {
    return { ...clientContext.current };
  }

  function instrumentationProperties(
    source: {
      readonly mode: CliSetupInstrumentationMode | undefined;
      readonly codingTool?: string | undefined;
    } = instrumentation,
  ): {
    readonly instrumentationMode?: CliSetupInstrumentationMode | undefined;
    readonly codingTool?: string | undefined;
  } {
    return {
      ...(source.mode === undefined
        ? {}
        : { instrumentationMode: source.mode }),
      ...(source.codingTool === undefined
        ? {}
        : { codingTool: source.codingTool }),
    };
  }

  function queueEvent(event: SetupEventRequest): void {
    const delivery = (async () => {
      const session = await start();
      if (!session?.event_token) return;
      try {
        const response = await fetchRequest(
          `${DEFAULT_APP_URL}/api/cli/wizard-session/event`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.event_token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(EVENT_REQUEST_TIMEOUT_MS),
          },
        );
        if (response.ok) return;
        void response.body?.cancel().catch(() => {
          // Discarding an error response is also best-effort. Some stream
          // implementations can reject cancellation asynchronously.
        });
      } catch {
        // Setup event delivery must never interrupt the wizard.
      }
    })();
    pending.add(delivery);
    void delivery.then(
      () => pending.delete(delivery),
      () => pending.delete(delivery),
    );
  }

  function startStep(
    name: CliSetupStepName,
    stepArgs?: {
      readonly failureCategory?: CliSetupFailureCategory | undefined;
    },
  ): WizardEventStep {
    const stepSequence = ++lastStepSequence;
    const step = { id: String(stepSequence), name };
    activeSteps.set(step.id, {
      ...step,
      startedAtMs: monotonicNow(),
      stepSequence,
      defaultFailureCategory: stepArgs?.failureCategory,
      instrumentationMode: instrumentation.mode,
      codingTool: instrumentation.codingTool,
    });
    queueEvent({
      occurredAt: now().toISOString(),
      clientContext: contextSnapshot(),
      event: "cliSetupStep",
      properties: {
        step: name,
        stepSequence,
        clientEventSequence: ++lastClientEventSequence,
        outcome: "started",
        ...instrumentationProperties(),
      },
    });
    return step;
  }

  function finishStep(
    step: WizardEventStep,
    outcome: Exclude<CliSetupStepOutcome, "started">,
    finishArgs?: WizardStepFinishArgs,
  ): void {
    const active = activeSteps.get(step.id);
    if (!active) return;
    activeSteps.delete(step.id);
    const instrumentation = instrumentationProperties(
      finishArgs?.instrumentation ?? {
        mode: active.instrumentationMode,
        codingTool: active.codingTool,
      },
    );
    const commonProperties = {
      step: active.name,
      stepSequence: active.stepSequence,
      clientEventSequence: ++lastClientEventSequence,
      durationMs: Math.max(0, Math.round(monotonicNow() - active.startedAtMs)),
      ...instrumentation,
      repositoryState: finishArgs?.repositoryState,
      repositoryDecision: finishArgs?.repositoryDecision,
      codingToolResults: finishArgs?.codingToolResults,
      instrumentationResult: finishArgs?.instrumentationResult,
      verificationMethod: finishArgs?.verificationMethod,
      reasonCode: finishArgs?.reasonCode,
    };
    let properties: StepEventProperties;
    if (outcome === "failed" || outcome === "cancelled") {
      properties = {
        ...commonProperties,
        outcome,
        failureCategory:
          finishArgs?.failureCategory ??
          active.defaultFailureCategory ??
          (outcome === "cancelled" ? "cancelled" : "unknown"),
      };
    } else {
      properties = {
        ...commonProperties,
        outcome,
      };
    }
    queueEvent({
      occurredAt: now().toISOString(),
      clientContext: contextSnapshot(),
      event: "cliSetupStep",
      properties,
    });
  }

  async function flush(): Promise<void> {
    if (pending.size === 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          resolve();
        }, FINAL_FLUSH_TIMEOUT_MS);
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    if (timedOut) sessionAbortController.abort();
  }

  return {
    start,
    setAuthMode(authMode) {
      clientContext.current = { ...clientContext.current, authMode };
    },
    setInstrumentation({ mode, codingTool }) {
      instrumentation.mode = mode;
      instrumentation.codingTool = codingTool;
    },
    startStep,
    finishStep,
    terminate(termination) {
      if (terminationPromise !== undefined) return terminationPromise;
      terminationPromise = (async () => {
        const active = [...activeSteps.values()].sort(
          (a, b) => b.stepSequence - a.stepSequence,
        );
        const currentStep = active[0];
        let failureCategory =
          termination.failureCategory ?? currentStep?.defaultFailureCategory;
        if (failureCategory === undefined) {
          if (termination.outcome === "cancelled") {
            failureCategory = "cancelled";
          } else if (termination.outcome === "failed") {
            failureCategory = "unknown";
          }
        }
        const activeOutcome =
          termination.outcome === "cancelled" ? "cancelled" : "failed";
        for (const step of active) {
          finishStep(step, activeOutcome, {
            failureCategory:
              termination.failureCategory ?? step.defaultFailureCategory,
            reasonCode: termination.reasonCode,
            ...(activeOutcome === "cancelled" &&
            termination.reasonCode === "user_interrupt" &&
            step.name === "instrumentation_run"
              ? { instrumentationResult: "user_cancellation" as const }
              : {}),
          });
        }
        const commonProperties = {
          clientEventSequence: ++lastClientEventSequence,
          ...(currentStep === undefined
            ? {}
            : { currentStep: currentStep.name }),
          durationMs: Math.max(0, Math.round(monotonicNow() - startedAtMs)),
          ...instrumentationProperties(),
        };
        let properties: TerminatedEventProperties;
        if (termination.outcome === "completed") {
          properties = {
            ...commonProperties,
            outcome: "completed",
          };
        } else {
          properties = {
            ...commonProperties,
            outcome: termination.outcome,
            failureCategory: failureCategory ?? "unknown",
            reasonCode: termination.reasonCode,
          };
        }
        queueEvent({
          occurredAt: now().toISOString(),
          clientContext: contextSnapshot(),
          event: "cliSetupTerminated",
          properties,
        });
        await flush();
      })().catch(() => {
        // Telemetry is always best-effort and must never affect setup's exit
        // status, even if an unexpected error escapes the delivery path.
      });
      return terminationPromise;
    },
  };
}
