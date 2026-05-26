import { describe, expect, it } from "vitest";

import { renderPrompt } from "../src/prompt";

describe("renderPrompt", () => {
  it("renders a non-interactive Braintrust instrumentation prompt", () => {
    const prompt = renderPrompt({
      interactive: false,
      orgName: "acme",
      projectName: "demo",
      resultFilePath: "/tmp/result.txt",
    });

    expect(prompt).toContain("https://www.braintrust.dev/docs");
    expect(prompt).toContain(
      "https://www.braintrust.dev/docs/instrument/trace-llm-calls",
    );
    expect(prompt).toContain("Project name to set in code: demo");
    expect(prompt).toContain("Do not ask the terminal user questions");
    expect(prompt).toContain("INSTRUMENTATION_COMPLETE");
    expect(prompt).toContain("/tmp/result.txt");
    expect(prompt).not.toContain("provider API key");
    expect(prompt).not.toContain("ask the user which");
    expect(prompt).not.toContain("| Language | Doc URL |");
    expect(prompt).not.toContain("#typescript");
    expect(prompt).not.toContain("Prefer local `bt`");
  });
});
