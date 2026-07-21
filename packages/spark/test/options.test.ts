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
    const saved = process.env.BRAINTRUST_APP_URL;
    process.env.BRAINTRUST_APP_URL = "https://app.env/app";
    try {
      const options = await parseArgs([], process.env);

      expect(options.appUrl).toBe(DEFAULT_APP_URL);
      expect(process.env.BRAINTRUST_APP_URL).toBe("https://app.env/app");
    } finally {
      if (saved === undefined) delete process.env.BRAINTRUST_APP_URL;
      else process.env.BRAINTRUST_APP_URL = saved;
    }
  });

  it("parses wizard-specific BRAINTRUST env defaults", async () => {
    const options = await parseArgs([], {
      BRAINTRUST_API_URL: "https://api.env/",
      BRAINTRUST_ORG_ID: "org-env",
      BRAINTRUST_PROJ_ID: "proj-env",
    });

    expect(options.apiUrl).toBe("https://api.env");
    expect(options.orgId).toBe("org-env");
    expect(options.projId).toBe("proj-env");
  });

  it("parses browser login org and project id args", async () => {
    const options = await parseArgs(
      ["--org-id", "org-123", "--proj-id", "proj-456"],
      {},
    );

    expect(options.orgId).toBe("org-123");
    expect(options.projId).toBe("proj-456");
  });

  it("ignores additional arguments", async () => {
    const options = await parseArgs(
      [
        "extra-positional",
        "--unknown-flag",
        "unknown-value",
        "--org-id",
        "org-123",
      ],
      {},
    );

    expect(options.orgId).toBe("org-123");
  });

  it("parses the hidden setup attribution source", async () => {
    const options = await parseArgs(
      ["--from", "docs_typescript_quickstart"],
      {},
    );

    expect(options.from).toBe("docs_typescript_quickstart");
  });

  it("does not reject unrelated BRAINTRUST_* env vars", async () => {
    const saved = {
      BRAINTRUST_SETUP_API_KEY: process.env.BRAINTRUST_SETUP_API_KEY,
      BRAINTRUST_SETUP_PROJECT_ID: process.env.BRAINTRUST_SETUP_PROJECT_ID,
      BRAINTRUST_SETUP_YOLO: process.env.BRAINTRUST_SETUP_YOLO,
      BRAINTRUST_API_KEY: process.env.BRAINTRUST_API_KEY,
    };
    process.env.BRAINTRUST_SETUP_API_KEY = "sk-test";
    process.env.BRAINTRUST_SETUP_PROJECT_ID = "proj-123";
    process.env.BRAINTRUST_SETUP_YOLO = "1";
    process.env.BRAINTRUST_API_KEY = "sk-ambient";
    try {
      const options = await parseArgs([], process.env);
      expect(options.apiKey).toBe("sk-test");
      expect(options.projectId).toBe("proj-123");
      expect(options.yolo).toBe(true);
      expect(process.env.BRAINTRUST_API_KEY).toBe("sk-ambient");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
