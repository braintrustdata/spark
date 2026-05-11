import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BraintrustApiClient, BraintrustApiError } from "../src/braintrust-api";

describe("currentUserAwaitingProvisioning", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // No-op; tests stub fetch per-case.
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the user on first success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", email: "a@b.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const api = new BraintrustApiClient("https://api.example", "tok");

    const sleeps: number[] = [];
    const user = await api.currentUserAwaitingProvisioning({
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(user.id).toBe("u1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("retries on 401 and succeeds after a few attempts", async () => {
    const responses = [
      new Response("nope", { status: 401 }),
      new Response("nope", { status: 401 }),
      new Response(JSON.stringify({ id: "u1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    const fetchMock = vi.fn().mockImplementation(() => responses.shift()!);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = new BraintrustApiClient("https://api.example", "tok");
    const sleeps: number[] = [];
    const user = await api.currentUserAwaitingProvisioning({
      delaysMs: [10, 20, 30, 40, 50],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(user.id).toBe("u1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it("gives up after exhausting retries on persistent 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = new BraintrustApiClient("https://api.example", "tok");
    await expect(
      api.currentUserAwaitingProvisioning({
        delaysMs: [1, 2, 3],
        sleep: async () => {},
      }),
    ).rejects.toThrow(/still being provisioned/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry on non-401 errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = new BraintrustApiClient("https://api.example", "tok");
    await expect(
      api.currentUserAwaitingProvisioning({
        delaysMs: [1, 2, 3],
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(BraintrustApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
