import { AISecretTypes } from "@braintrust/proxy/schema";
import { describe, expect, it } from "vitest";

import { LLM_PROVIDERS } from "../src/providers";

// Provider IDs that the wizard offers but that aren't in the currently
// published `@braintrust/proxy@0.0.9` schema yet. Remove from this set
// once the corresponding proxy release ships.
const KNOWN_AHEAD: ReadonlySet<string> = new Set(["baseten"]);

function envVarToProviderId(envVar: string): string {
  return envVar.toLowerCase().replace(/_api_key$/, "");
}

describe("LLM_PROVIDERS sync with @braintrust/proxy/schema", () => {
  it("matches AISecretTypes (plus the custom entry and KNOWN_AHEAD)", () => {
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
      (id) => !fromSchema.has(id) && !KNOWN_AHEAD.has(id),
    );

    expect(missingFromWizard).toEqual([]);
    expect(extraInWizard).toEqual([]);
  });

  it("includes the custom self-hosted entry", () => {
    expect(LLM_PROVIDERS.some((p) => p.custom === true)).toBe(true);
  });

  it("uses each AISecretTypes env var verbatim", () => {
    const envVars = new Set(Object.keys(AISecretTypes));
    for (const provider of LLM_PROVIDERS) {
      if (provider.custom) continue;
      if (KNOWN_AHEAD.has(provider.id)) continue;
      expect(provider.envVar).toBeDefined();
      expect(envVars.has(provider.envVar!)).toBe(true);
    }
  });
});
