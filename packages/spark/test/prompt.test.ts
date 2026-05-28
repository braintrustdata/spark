import { describe, expect, it } from "vitest";

import { renderPrompt } from "../src/prompt";

describe("renderPrompt", () => {
  it("renders a Braintrust instrumentation prompt with target and result file", () => {
    const prompt = renderPrompt({
      orgName: "acme",
      projectName: "demo",
      includeResultFile: true,
    });

    expect(prompt).toContain("Braintrust SDK Installation");
    expect(prompt).toContain(
      "https://www.braintrust.dev/docs/instrument/trace-llm-calls",
    );
    expect(prompt).toContain("Organization: acme");
    expect(prompt).toContain("Project name to set in code: demo");
    expect(prompt).toContain("Resolve ambiguity from the repository");
    expect(prompt).toContain("BT_WIZARD_RESULT_FILE");
    expect(prompt).not.toContain("INSTRUMENTATION_COMPLETE");
    expect(prompt).not.toContain("INSTRUMENTATION_INCOMPLETE");
    expect(prompt).not.toContain("Unattended mode");
    expect(prompt).not.toContain("Interactive mode");
    expect(prompt).not.toContain("Non-interactive mode");
  });

  it("omits target and result-file sections when not provided", () => {
    const prompt = renderPrompt({});

    expect(prompt).toContain("Braintrust SDK Installation");
    expect(prompt).not.toContain("Braintrust Target");
    expect(prompt).not.toContain("Reporting the Trace Permalink");
  });
});
