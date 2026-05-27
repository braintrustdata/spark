import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BraintrustApiClient, BraintrustApiError } from "../src/braintrust-api";

describe("BraintrustApiClient", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // No-op; tests stub fetch per-case.
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches projects and organizations with bearer auth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "project/id", name: "demo", org_id: "org id" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "org id", name: "acme" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    globalThis.fetch = fetchMock;
    const api = new BraintrustApiClient("https://api.example", "tok");

    const project = await api.getProject("project/id");
    const org = await api.getOrg("org id");

    expect(project.name).toBe("demo");
    expect(org.name).toBe("acme");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example/v1/project/project%2Fid",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/json",
        },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.example/v1/organization/org%20id",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/json",
        },
      },
    );
  });

  it("throws BraintrustApiError on API failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    globalThis.fetch = fetchMock;

    const api = new BraintrustApiClient("https://api.example", "tok");
    await expect(api.getProject("p1")).rejects.toBeInstanceOf(
      BraintrustApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
