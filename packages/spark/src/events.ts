import { randomUUID } from "node:crypto";
import { isSea } from "node:sea";

import pkg from "../package.json" with { type: "json" };
import type { WizardSessionCreateResponse } from "./auth";
import type { WizardOptions } from "./options";

export type CliSetupEntryPoint =
  | "homepage"
  | "in_app_onboarding"
  | "docs"
  | "direct"
  | "ci";

export type CliSetupDocsPage =
  | "tracing_quickstart"
  | "csharp_quickstart"
  | "go_quickstart"
  | "java_quickstart"
  | "python_quickstart"
  | "ruby_quickstart"
  | "typescript_quickstart";

export type CliSetupAuthMode = "signin" | "signup" | "ci";
export type CliSetupInstrumentationMode = "built_in" | "own_agent" | "manual";

export type CliSetupStepName =
  | "repository_check"
  | "authentication"
  | "credentials_write"
  | "bt_cli_setup"
  | "coding_tool_preflight"
  | "instrumentation_selection"
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

export type CliSetupClientContext = {
  readonly cliVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly distribution: "standalone" | "node";
  readonly entryPoint: CliSetupEntryPoint;
  readonly docsPage?: CliSetupDocsPage | undefined;
  readonly authMode?: CliSetupAuthMode | undefined;
};

export type WizardEventStep = {
  readonly id: string;
  readonly name: CliSetupStepName;
};

export type WizardEventsRuntime = {
  readonly start: () => Promise<WizardSessionCreateResponse | undefined>;
  readonly setAuthMode: (authMode: CliSetupAuthMode) => void;
  readonly setInstrumentation: (args: {
    readonly mode: CliSetupInstrumentationMode;
    readonly codingTool?: string | undefined;
  }) => void;
  readonly startStep: (
    name: CliSetupStepName,
    args?: {
      readonly failureCategory?: CliSetupFailureCategory | undefined;
    },
  ) => WizardEventStep;
  readonly finishStep: (
    step: WizardEventStep,
    outcome: Exclude<CliSetupStepOutcome, "started">,
    args?: {
      readonly failureCategory?: CliSetupFailureCategory | undefined;
    },
  ) => void;
  readonly terminate: (args: {
    readonly outcome: "completed" | "cancelled" | "failed";
    readonly failureCategory?: CliSetupFailureCategory | undefined;
  }) => Promise<void>;
};

type ActiveStep = WizardEventStep & {
  readonly startedAtMs: number;
  readonly startedSequence: number;
  readonly defaultFailureCategory: CliSetupFailureCategory | undefined;
  readonly instrumentationMode: CliSetupInstrumentationMode | undefined;
  readonly codingTool: string | undefined;
};

type SetupEventRequest =
  | {
      readonly messageId: string;
      readonly occurredAt: string;
      readonly clientContext: CliSetupClientContext;
      readonly event: "cliSetupStep";
      readonly properties: {
        readonly step: CliSetupStepName;
        readonly outcome: CliSetupStepOutcome;
        readonly durationMs?: number | undefined;
        readonly instrumentationMode?: CliSetupInstrumentationMode | undefined;
        readonly codingTool?: string | undefined;
        readonly failureCategory?: CliSetupFailureCategory | undefined;
      };
    }
  | {
      readonly messageId: string;
      readonly occurredAt: string;
      readonly clientContext: CliSetupClientContext;
      readonly event: "cliSetupTerminated";
      readonly properties: {
        readonly outcome: "completed" | "cancelled" | "failed";
        readonly currentStep?: CliSetupStepName | undefined;
        readonly durationMs: number;
        readonly failureCategory?: CliSetupFailureCategory | undefined;
        readonly instrumentationMode?: CliSetupInstrumentationMode | undefined;
        readonly codingTool?: string | undefined;
      };
    };

const EVENT_REQUEST_TIMEOUT_MS = 2_000;
const FINAL_FLUSH_TIMEOUT_MS = 2_000;

const DOCS_SOURCE_PREFIX = "docs_";
const DOCS_PAGES = new Set<CliSetupDocsPage>([
  "tracing_quickstart",
  "csharp_quickstart",
  "go_quickstart",
  "java_quickstart",
  "python_quickstart",
  "ruby_quickstart",
  "typescript_quickstart",
]);

export function setupAttribution(args: {
  readonly from?: string | undefined;
  readonly ci: boolean;
}): Pick<CliSetupClientContext, "entryPoint" | "docsPage"> {
  if (args.ci) return { entryPoint: "ci" };
  if (args.from === "homepage") return { entryPoint: "homepage" };
  if (args.from === "in_app_onboarding") {
    return { entryPoint: "in_app_onboarding" };
  }
  if (args.from?.startsWith(DOCS_SOURCE_PREFIX)) {
    const docsPage = args.from.slice(DOCS_SOURCE_PREFIX.length);
    if (DOCS_PAGES.has(docsPage as CliSetupDocsPage)) {
      return {
        entryPoint: "docs",
        docsPage: docsPage as CliSetupDocsPage,
      };
    }
  }
  return { entryPoint: "direct" };
}

export function buildCliSetupClientContext(
  options: WizardOptions,
): CliSetupClientContext {
  const ci = options.apiKey !== undefined && options.projectId !== undefined;
  return {
    cliVersion: pkg.version,
    platform: process.platform,
    architecture: process.arch,
    distribution: isSea() ? "standalone" : "node",
    ...setupAttribution({ from: options.from, ci }),
    ...(ci ? { authMode: "ci" as const } : {}),
  };
}

export function createWizardEvents(args: {
  readonly appUrl: string;
  readonly clientContext: CliSetupClientContext;
  readonly createSession: (
    clientContext: CliSetupClientContext,
    signal: AbortSignal,
  ) => Promise<WizardSessionCreateResponse>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly createMessageId?: () => string;
}): WizardEventsRuntime {
  const fetchRequest = args.fetch ?? globalThis.fetch;
  const now = args.now ?? (() => new Date());
  const monotonicNow = args.monotonicNow ?? (() => performance.now());
  const createMessageId = args.createMessageId ?? randomUUID;
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
  let started = false;
  let terminated = false;
  let stepSequence = 0;

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

  function instrumentationProperties(source = instrumentation): {
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
          `${args.appUrl}/api/cli/wizard-session/event`,
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
        if (!response.ok) void response.body?.cancel();
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
    const step = { id: createMessageId(), name };
    activeSteps.set(step.id, {
      ...step,
      startedAtMs: monotonicNow(),
      startedSequence: ++stepSequence,
      defaultFailureCategory: stepArgs?.failureCategory,
      instrumentationMode: instrumentation.mode,
      codingTool: instrumentation.codingTool,
    });
    queueEvent({
      messageId: createMessageId(),
      occurredAt: now().toISOString(),
      clientContext: contextSnapshot(),
      event: "cliSetupStep",
      properties: {
        step: name,
        outcome: "started",
        ...instrumentationProperties(),
      },
    });
    return step;
  }

  function finishStep(
    step: WizardEventStep,
    outcome: Exclude<CliSetupStepOutcome, "started">,
    finishArgs?: {
      readonly failureCategory?: CliSetupFailureCategory | undefined;
    },
  ): void {
    const active = activeSteps.get(step.id);
    if (!active) return;
    activeSteps.delete(step.id);
    const failureCategory =
      finishArgs?.failureCategory ??
      (outcome === "failed" ? active.defaultFailureCategory : undefined);
    queueEvent({
      messageId: createMessageId(),
      occurredAt: now().toISOString(),
      clientContext: contextSnapshot(),
      event: "cliSetupStep",
      properties: {
        step: active.name,
        outcome,
        durationMs: Math.max(
          0,
          Math.round(monotonicNow() - active.startedAtMs),
        ),
        ...instrumentationProperties({
          mode: active.instrumentationMode,
          codingTool: active.codingTool,
        }),
        ...(failureCategory === undefined ? {} : { failureCategory }),
      },
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
    async terminate(termination) {
      if (terminated) return;
      terminated = true;
      const active = [...activeSteps.values()].sort(
        (a, b) => b.startedSequence - a.startedSequence,
      );
      const currentStep = active[0];
      const failureCategory =
        termination.failureCategory ?? currentStep?.defaultFailureCategory;
      const activeOutcome =
        termination.outcome === "cancelled" ? "cancelled" : "failed";
      for (const step of active) {
        finishStep(step, activeOutcome, {
          failureCategory:
            termination.failureCategory ?? step.defaultFailureCategory,
        });
      }
      queueEvent({
        messageId: createMessageId(),
        occurredAt: now().toISOString(),
        clientContext: contextSnapshot(),
        event: "cliSetupTerminated",
        properties: {
          outcome: termination.outcome,
          ...(currentStep === undefined
            ? {}
            : { currentStep: currentStep.name }),
          durationMs: Math.max(0, Math.round(monotonicNow() - startedAtMs)),
          ...instrumentationProperties(),
          ...(failureCategory === undefined ? {} : { failureCategory }),
        },
      });
      await flush();
    },
  };
}
