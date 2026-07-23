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
    expect(setupAttribution({ from, ci: false })).toEqual(expected);
  });

  it("uses CI attribution regardless of the supplied source", () => {
    expect(setupAttribution({ from: "homepage", ci: true })).toEqual({
      entryPoint: "ci",
    });
  });

  it("builds CI context from credential options", () => {
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
      entryPoint: "ci",
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
      appUrl: "https://app.test",
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
      expect(call[0]).toBe("https://app.test/api/cli/wizard-session/event");
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
      outcome: "completed",
      durationMs: 25,
    });
    expect(requests.every((request) => !("messageId" in request))).toBe(true);
    expect(requests[3]?.properties).toMatchObject({
      step: "instrumentation_run",
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
  });

  it("does not send events when an older server omits the event token", async () => {
    const fetchMock = vi.fn();
    const events = createWizardEvents({
      appUrl: "https://app.test",
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

  it("suppresses session and event delivery failures", async () => {
    const failedSessionEvents = createWizardEvents({
      appUrl: "https://app.test",
      clientContext: CONTEXT,
      createSession: () => Promise.reject(new Error("offline")),
    });
    const failedEventDelivery = createWizardEvents({
      appUrl: "https://app.test",
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
});
