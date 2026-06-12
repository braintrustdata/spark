import { describe, expect, it } from "vitest";

import { DEFAULT_APP_URL, parseArgs } from "../src/options";

describe("parseArgs", () => {
  it("still parses hidden API and app URL args", async () => {
    const options = await parseArgs(
      ["--api-url", "https://api.test/", "--app-url", "https://app.test/"],
      {},
    );

    expect(options.apiUrl).toBe("https://api.test");
    expect(options.appUrl).toBe("https://app.test");
  });

  it("does not treat BRAINTRUST_APP_URL as prompt app URL copy", async () => {
    const options = await parseArgs([], {
      BRAINTRUST_APP_URL: "https://app.env/",
    });

    expect(options.appUrl).toBe(DEFAULT_APP_URL);
  });

  it("parses browser login org and project id args", async () => {
    const options = await parseArgs(
      ["--org-id", "org-123", "--proj-id", "proj-456"],
      {},
    );

    expect(options.orgId).toBe("org-123");
    expect(options.projId).toBe("proj-456");
  });

  it("does not reject BRAINTRUST_SETUP_* env vars under strict parsing", async () => {
    const saved = {
      BRAINTRUST_SETUP_API_KEY: process.env.BRAINTRUST_SETUP_API_KEY,
      BRAINTRUST_SETUP_PROJECT_ID: process.env.BRAINTRUST_SETUP_PROJECT_ID,
      BRAINTRUST_SETUP_YOLO: process.env.BRAINTRUST_SETUP_YOLO,
    };
    process.env.BRAINTRUST_SETUP_API_KEY = "sk-test";
    process.env.BRAINTRUST_SETUP_PROJECT_ID = "proj-123";
    process.env.BRAINTRUST_SETUP_YOLO = "1";
    try {
      const options = await parseArgs([], process.env);
      expect(options.apiKey).toBe("sk-test");
      expect(options.projectId).toBe("proj-123");
      expect(options.yolo).toBe(true);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
