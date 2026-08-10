import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWizardSessionLoginUrl,
  createWizardSession,
  loginWithWizardSession,
  type WizardSessionCreateResponse,
} from "../src/auth";

const SESSION: WizardSessionCreateResponse = {
  session_token: "session-token",
  poll_token: "poll-token",
  expires_at: "2099-01-01T00:00:00.000Z",
  login_path: "/app/cli-login?session_token=session-token",
  verification_code: "123456",
  event_token: "event-token",
};

describe("buildWizardSessionLoginUrl", () => {
  it("uses the login path returned by the session create endpoint", () => {
    expect(buildWizardSessionLoginUrl("https://app.test", SESSION)).toBe(
      "https://app.test/app/cli-login?session_token=session-token",
    );
  });

  it("appends org, project, and auth params to the returned login path", () => {
    expect(
      buildWizardSessionLoginUrl("https://app.test", SESSION, {
        orgId: "org-123",
        projectId: "proj-456",
        authMode: "signup",
      }),
    ).toBe(
      "https://app.test/app/cli-login?session_token=session-token&org_id=org-123&project_id=proj-456&auth=signup",
    );
  });
});

describe("createWizardSession", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("does not pass login url params to the create endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SESSION), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;

    await createWizardSession("https://app.test");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/api/cli/wizard-session/create",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        signal: expect.any(AbortSignal) as AbortSignal,
      },
    );
  });

  it("passes setup client context to the create endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SESSION), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const clientContext = {
      cliVersion: "1.2.3",
      platform: "linux",
      architecture: "x64",
      entryPoint: "docs",
      docsPage: "typescript_quickstart",
      authMode: "signin",
    } as const;

    await createWizardSession("https://app.test", clientContext);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/api/cli/wizard-session/create",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientContext }),
        signal: expect.any(AbortSignal) as AbortSignal,
      },
    );
  });

  it("reuses a pre-created session for browser login", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "complete",
          api_key: "secret",
          org_id: "org-id",
          org_name: "acme",
          project_id: "project-id",
          project_name: "demo",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock;
    const onLoginUrl = vi.fn();
    const login = loginWithWizardSession({
      appUrl: "https://app.test",
      session: SESSION,
      events: {
        onLoginUrl,
        onTryOpenBrowser: () => Promise.resolve(true),
      },
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(login).resolves.toMatchObject({
      apiKey: "secret",
      projectId: "project-id",
    });
    expect(onLoginUrl).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/cli/wizard-session/poll",
    );
  });

  it("keeps polling after a transient connection failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "complete",
            api_key: "secret",
            org_id: "org-id",
            org_name: "acme",
            project_id: "project-id",
            project_name: "demo",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    globalThis.fetch = fetchMock;
    const login = loginWithWizardSession({
      appUrl: "https://app.test",
      session: SESSION,
      events: {
        onLoginUrl: vi.fn(),
        onTryOpenBrowser: () => Promise.resolve(true),
      },
    });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(login).resolves.toMatchObject({ projectId: "project-id" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
