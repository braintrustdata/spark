import { AISecretTypes } from "@braintrust/proxy/schema";
import { describe, expect, it } from "vitest";

import { LLM_PROVIDERS } from "../src/providers";

// Provider IDs that the wizard offers but that aren't in the currently
// published `@braintrust/proxy@0.0.9` schema yet. Remove from this set
// once the corresponding proxy release ships.
const KNOWN_AHEAD: ReadonlySet<string> = new Set(["baseten"]);

// Multi-credential providers use several env vars instead of a single API key
// and are intentionally absent from AISecretTypes.
const MULTI_CREDENTIAL: ReadonlySet<string> = new Set(
  LLM_PROVIDERS.filter((p) => p.credentials !== undefined).map((p) => p.id),
);

function envVarToProviderId(envVar: string): string {
  return envVar.toLowerCase().replace(/_api_key$/, "");
}

describe("LLM_PROVIDERS sync with @braintrust/proxy/schema", () => {
  it("matches AISecretTypes (plus the custom entry, KNOWN_AHEAD, and MULTI_CREDENTIAL)", () => {
    const fromSchema = new Set(
      Object.keys(AISecretTypes).map(envVarToProviderId),
    );
    const fromWizard = new Set(
      LLM_PROVIDERS.filter((p) => !p.custom).map((p) => p.id),
    );

    const missingFromWizard = [...fromSchema].filter(
      (id) => !fromWizard.has(id),
    );
    const extraInWizard = [...fromWizard].filter(
      (id) =>
        !fromSchema.has(id) &&
        !KNOWN_AHEAD.has(id) &&
        !MULTI_CREDENTIAL.has(id),
    );

    expect(missingFromWizard).toEqual([]);
    expect(extraInWizard).toEqual([]);
  });

  it("includes the custom self-hosted entry", () => {
    expect(LLM_PROVIDERS.some((p) => p.custom === true)).toBe(true);
  });

  it("uses each AISecretTypes env var verbatim for single-key providers", () => {
    const envVars = new Set(Object.keys(AISecretTypes));
    for (const provider of LLM_PROVIDERS) {
      if (provider.custom) continue;
      if (KNOWN_AHEAD.has(provider.id)) continue;
      if (MULTI_CREDENTIAL.has(provider.id)) continue;
      expect(envVars.has(provider.envVar)).toBe(true);
    }
  });

  it("multi-credential providers each have at least one credential field", () => {
    for (const provider of LLM_PROVIDERS.filter(
      (p) => p.credentials !== undefined,
    )) {
      expect(provider.credentials!.length).toBeGreaterThan(0);
    }
  });
});
