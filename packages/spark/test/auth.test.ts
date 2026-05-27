import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWizardSessionLoginUrl,
  createWizardSession,
  type WizardSessionCreateResponse,
} from "../src/auth";

const SESSION: WizardSessionCreateResponse = {
  session_token: "session-token",
  poll_token: "poll-token",
  expires_at: "2099-01-01T00:00:00.000Z",
  login_path: "/app/cli-login?session_token=session-token",
  verification_code: "123456",
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
});
