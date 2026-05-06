import { describe, expect, it } from "vitest";

import { createQueryClient } from "../src/query-client";
import {
  createWizardSigninClient,
  getWizardBackendUrl,
  loginUrlWithAuthMode,
  WIZARD_BACKEND_URL_ENV,
} from "../src/wizard-signin-client";

describe("wizard sign-in client", () => {
  it("uses the configured backend URL from the environment", () => {
    expect(
      getWizardBackendUrl({
        [WIZARD_BACKEND_URL_ENV]: "http://localhost:3000/",
      }),
    ).toBe("http://localhost:3000");
  });

  it("adds the auth mode to login URLs while preserving existing params", () => {
    expect(
      loginUrlWithAuthMode(
        "http://backend.test/app/cli-login/session-id",
        "signin",
      ),
    ).toBe("http://backend.test/app/cli-login/session-id?auth=signin");
    expect(
      loginUrlWithAuthMode(
        "http://backend.test/app/cli-login/session-id?source=cli",
        "signup",
      ),
    ).toBe(
      "http://backend.test/app/cli-login/session-id?source=cli&auth=signup",
    );
  });

  it("calls the create and poll endpoints from the configured backend", async () => {
    const calls: Array<{
      readonly body: unknown;
      readonly headers: Headers;
      readonly method: string | undefined;
      readonly url: string;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        body: init?.body,
        headers: new Headers(init?.headers),
        method: init?.method,
        url: String(input),
      });

      if (String(input).endsWith("/create")) {
        return Response.json({
          expires_at: "2026-05-06T21:15:00.000Z",
          id: "session-id",
          login_path: "/app/cli-login/session-id",
          login_url: "http://backend.test/app/cli-login/session-id",
          poll_token: "poll-token",
        });
      }

      return Response.json({
        api_key: "sk-test-api-key",
        org_info: {
          id: "org-id",
          name: "Acme",
        },
        project: {
          id: "project-id",
          name: "Demo",
        },
        status: "complete",
      });
    };
    const client = createWizardSigninClient({
      backendUrl: "http://backend.test/",
      fetchImpl,
      queryClient: createQueryClient(),
    });

    const session = await client.createSigninSession();
    const result = await client.pollSigninSession(session);

    expect(session).toEqual({
      expiresAt: "2026-05-06T21:15:00.000Z",
      id: "session-id",
      loginPath: "/app/cli-login/session-id",
      loginUrl: "http://backend.test/app/cli-login/session-id",
      pollToken: "poll-token",
    });
    expect(result).toEqual({
      apiKey: "sk-test-api-key",
      orgInfo: {
        id: "org-id",
        name: "Acme",
      },
      project: {
        id: "project-id",
        name: "Demo",
      },
      status: "complete",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      body: JSON.stringify({ client_name: "braintrust-wizard" }),
      method: "POST",
      url: "http://backend.test/api/cli/wizard-signin/create",
    });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(calls[1]).toMatchObject({
      method: "GET",
      url: "http://backend.test/api/cli/wizard-signin/poll?id=session-id",
    });
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer poll-token");
  });
});
