import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/options";

describe("parseArgs", () => {
  it("still parses hidden API and app URL args", async () => {
    const options = await parseArgs(
      ["--api-url", "https://api.test/", "--app-url", "https://app.test/"],
      {},
    );

    expect(options.apiUrl).toBe("https://api.test");
    expect(options.appUrl).toBe("https://app.test");
  });

  it("parses browser login org and project id args", async () => {
    const options = await parseArgs(
      ["--org-id", "org-123", "--proj-id", "proj-456"],
      {},
    );

    expect(options.orgId).toBe("org-123");
    expect(options.projId).toBe("proj-456");
  });
});
