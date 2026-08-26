import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

import { createBraintrustCliRuntime } from "../src/braintrust-cli";

describe("Braintrust CLI runtime", () => {
  it("configures and reads context using the real bt CLI", async () => {
    const home = await mkdtemp(join(tmpdir(), "braintrust-cli-test-"));
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");

      if (request.method === "POST" && request.url === "/api/apikey/login") {
        response.end(
          JSON.stringify({
            org_info: [
              {
                id: "org-id",
                name: "acme",
                api_url: serverUrl(server).href,
              },
            ],
          }),
        );
        return;
      }

      if (
        request.method === "GET" &&
        request.url === "/v1/project?org_name=acme&project_name=demo"
      ) {
        response.end(
          JSON.stringify({
            objects: [{ id: "project-id", name: "demo", org_id: "org-id" }],
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const url = serverUrl(server);
      const runtime = createBraintrustCliRuntime({
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          BRAINTRUST_API_URL: url.href,
          BRAINTRUST_APP_URL: url.href,
        },
      });
      const discovery = await runtime.discover();

      expect(discovery).toMatchObject({ installed: true });
      expect(discovery.commandPath).toBeDefined();
      expect(discovery.version).toBeDefined();

      await runtime.loginAndSwitch(discovery.commandPath!, {
        apiKey: "bt-secret-key",
        apiUrl: url.href,
        appUrl: url.href,
        orgName: "acme",
        projectName: "demo",
      });

      await expect(
        runtime.status(discovery.commandPath!),
      ).resolves.toMatchObject({
        profile: "acme",
        org: "acme",
        project: "demo",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(home, { recursive: true, force: true });
    }
  });
});

function serverUrl(server: ReturnType<typeof createServer>): URL {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API server is not listening on a TCP port.");
  }
  const url = new URL("http://127.0.0.1");
  url.port = String(address.port);
  return url;
}
