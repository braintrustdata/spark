import { describe, expect, it, vi } from "vitest";

import type { WizardSessionCreateResponse } from "../src/auth";
import {
  buildCliSetupClientContext,
  createWizardEvents,
  setupAttribution,
  type CliSetupClientContext,
} from "../src/events";

const SESSION: WizardSessionCreateResponse = {
  session_token: "session-token",
  poll_token: "poll-token",
  event_token: "event-token",
  expires_at: "2099-01-01T00:00:00.000Z",
  login_path: "/app/wizard-login?session_token=session-token",
  verification_code: "123456",
};

const CONTEXT: CliSetupClientContext = {
  cliVersion: "1.2.3",
  platform: "linux",
  architecture: "x64",
  entryPoint: "direct",
};

describe("setupAttribution", () => {
  it.each([
    ["homepage", { entryPoint: "homepage" }],
    ["in_app_onboarding", { entryPoint: "in_app_onboarding" }],
    ["in_app_setup", { entryPoint: "in_app_setup" }],
    [
      "docs_tracing_quickstart",
      { entryPoint: "docs", docsPage: "tracing_quickstart" },
    ],
    [
      "docs_csharp_quickstart",
      { entryPoint: "docs", docsPage: "csharp_quickstart" },
    ],
    ["docs_go_quickstart", { entryPoint: "docs", docsPage: "go_quickstart" }],
    [
      "docs_java_quickstart",
      { entryPoint: "docs", docsPage: "java_quickstart" },
    ],
    [
      "docs_python_quickstart",
      { entryPoint: "docs", docsPage: "python_quickstart" },
    ],
    [
      "docs_ruby_quickstart",
      { entryPoint: "docs", docsPage: "ruby_quickstart" },
    ],
    [
      "docs_typescript_quickstart",
      { entryPoint: "docs", docsPage: "typescript_quickstart" },
    ],
    ["unknown", { entryPoint: "direct" }],
    [undefined, { entryPoint: "direct" }],
  ] as const)("maps %s", (from, expected) => {
    expect(setupAttribution({ from })).toEqual(expected);
  });

  it("builds credential auth context without replacing the entry point", () => {
    const context = buildCliSetupClientContext({
      apiUrl: "https://api.test",
      appUrl: "https://app.test",
      apiKey: "secret",
      projectId: "project-id",
      orgId: undefined,
      projId: undefined,
      yolo: false,
      from: "homepage",
    });

    expect(context).toMatchObject({
      entryPoint: "homepage",
      authMode: "ci",
    });
    expect(context.cliVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(context.platform).toBe(process.platform);
    expect(context.architecture).toBe(process.arch);
  });
});

describe("createWizardEvents", () => {
  it("sends step and termination events with scoped authorization", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const createSession = vi.fn().mockResolvedValue(SESSION);
    let monotonicTime = 10;
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession,
      fetch: fetchMock,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
      monotonicNow: () => monotonicTime,
    });

    const session = events.start();
    const authenticationStep = events.startStep("authentication", {
      failureCategory: "auth",
    });
    monotonicTime = 35;
    events.finishStep(authenticationStep, "completed");
    events.setAuthMode("signin");
    events.setInstrumentation({ mode: "built_in", codingTool: "codex" });
    const instrumentationStep = events.startStep("instrumentation_run", {
      failureCategory: "coding_tool_failed",
    });
    monotonicTime = 60;
    events.finishStep(instrumentationStep, "failed");
    monotonicTime = 75;
    await events.terminate({ outcome: "completed" });

    await expect(session).resolves.toBe(SESSION);
    expect(createSession).toHaveBeenCalledWith(
      CONTEXT,
      expect.any(AbortSignal),
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const requests = fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      expect(call[0]).toBe(
        "https://www.braintrust.dev/api/cli/wizard-session/event",
      );
      expect(init.headers).toEqual({
        Authorization: "Bearer event-token",
        Accept: "application/json",
        "Content-Type": "application/json",
      });
      return JSON.parse(init.body as string) as {
        event: string;
        clientContext: CliSetupClientContext;
        properties: Record<string, unknown>;
      };
    });
    expect(requests[1]?.properties).toMatchObject({
      step: "authentication",
      stepSequence: 1,
      outcome: "completed",
      durationMs: 25,
    });
    expect(requests.every((request) => !("messageId" in request))).toBe(true);
    expect(requests[3]?.properties).toMatchObject({
      step: "instrumentation_run",
      stepSequence: 2,
      outcome: "failed",
      durationMs: 25,
      instrumentationMode: "built_in",
      codingTool: "codex",
      failureCategory: "coding_tool_failed",
    });
    expect(requests[4]).toMatchObject({
      event: "cliSetupTerminated",
      clientContext: { authMode: "signin" },
      properties: {
        outcome: "completed",
        durationMs: 65,
        instrumentationMode: "built_in",
        codingTool: "codex",
      },
    });
    expect(
      requests
        .filter((request) => request.event === "cliSetupStep")
        .map((request) => request.properties.stepSequence),
    ).toEqual([1, 1, 2, 2]);
    expect(
      requests.map((request) => request.properties.clientEventSequence),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("reports repository decisions without local file details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.resolve(SESSION),
      fetch: fetchMock,
    });

    const step = events.startStep("repository_preflight", {
      failureCategory: "repository_state",
    });
    events.finishStep(step, "cancelled", {
      failureCategory: "repository_state",
      reasonCode: "repository_dirty_declined",
      repositoryState: "dirty",
      repositoryDecision: "cancel",
    });
    await events.terminate({
      outcome: "cancelled",
      failureCategory: "repository_state",
      reasonCode: "repository_dirty_declined",
    });

    const requests = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse((call[1] as RequestInit).body as string) as {
          properties: Record<string, unknown>;
        },
    );
    expect(requests[1]?.properties).toMatchObject({
      clientEventSequence: 2,
      repositoryState: "dirty",
      repositoryDecision: "cancel",
      reasonCode: "repository_dirty_declined",
    });
    expect(requests[2]?.properties).toMatchObject({
      clientEventSequence: 3,
      reasonCode: "repository_dirty_declined",
    });
    expect(JSON.stringify(requests)).not.toContain("file");
  });

  it("does not send events when an older server omits the event token", async () => {
    const fetchMock = vi.fn();
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () =>
        Promise.resolve({ ...SESSION, event_token: undefined }),
      fetch: fetchMock,
    });

    const step = events.startStep("authentication");
    events.finishStep(step, "completed");
    await events.terminate({ outcome: "completed" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a finished selection step to report the newly selected instrumentation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.resolve(SESSION),
      fetch: fetchMock,
    });

    const initialSelection = events.startStep("instrumentation_selection");
    events.setInstrumentation({ mode: "built_in" });
    events.finishStep(initialSelection, "completed", {
      instrumentation: { mode: "built_in" },
    });
    events.setInstrumentation({ mode: "built_in", codingTool: "codex" });
    const alternateSelection = events.startStep("instrumentation_selection");
    events.setInstrumentation({ mode: "manual" });
    events.finishStep(alternateSelection, "completed", {
      instrumentation: { mode: "manual" },
    });
    await events.terminate({ outcome: "completed" });

    const properties = fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      return (
        JSON.parse(init.body as string) as {
          properties: Record<string, unknown>;
        }
      ).properties;
    });
    expect(properties[0]).not.toHaveProperty("instrumentationMode");
    expect(properties[1]).toMatchObject({
      step: "instrumentation_selection",
      outcome: "completed",
      instrumentationMode: "built_in",
    });
    expect(properties[2]).toMatchObject({
      step: "instrumentation_selection",
      outcome: "started",
      instrumentationMode: "built_in",
      codingTool: "codex",
    });
    expect(properties[3]).toMatchObject({
      step: "instrumentation_selection",
      outcome: "completed",
      instrumentationMode: "manual",
    });
    expect(properties[3]).not.toHaveProperty("codingTool");
  });

  it("suppresses session and event delivery failures", async () => {
    const failedSessionEvents = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.reject(new Error("offline")),
    });
    const failedEventDelivery = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.resolve(SESSION),
      fetch: () => Promise.reject(new Error("offline")),
    });

    await expect(failedSessionEvents.start()).resolves.toBeUndefined();
    await expect(
      failedSessionEvents.terminate({ outcome: "failed" }),
    ).resolves.toBeUndefined();
    await expect(
      failedEventDelivery.terminate({ outcome: "failed" }),
    ).resolves.toBeUndefined();
  });

  it("does not retry a failed event delivery", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.resolve(SESSION),
      fetch: fetchMock,
    });

    await events.terminate({ outcome: "completed" });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends the current payload when the backend rejects an event", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 400 }));
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.resolve(SESSION),
      fetch: fetchMock,
    });

    await events.terminate({
      outcome: "cancelled",
      reasonCode: "user_interrupt",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as { properties: Record<string, unknown> };
    expect(payload.properties).toMatchObject({
      clientEventSequence: 1,
      reasonCode: "user_interrupt",
    });
  });

  it("suppresses response body cancellation failures", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new ReadableStream({ cancel }), {
          status: 500,
        }),
      ),
    );
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.resolve(SESSION),
      fetch: fetchMock,
    });

    await expect(
      events.terminate({ outcome: "completed" }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("makes concurrent termination calls await the same flush", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const events = createWizardEvents({
      clientContext: CONTEXT,
      createSession: () => Promise.resolve(SESSION),
      fetch: fetchMock,
    });

    const first = events.terminate({
      outcome: "cancelled",
      reasonCode: "user_interrupt",
    });
    const second = events.terminate({ outcome: "failed" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    resolveFetch?.(new Response(null, { status: 204 }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
