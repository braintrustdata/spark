import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

import { createBraintrustCliRuntime } from "../src/braintrust-cli";
import { DEFAULT_API_URL, DEFAULT_APP_URL } from "../src/options";

describe("Braintrust CLI runtime", () => {
  it.runIf(process.env.CI === "true")(
    "configures and reads context using the real bt CLI",
    async () => {
      const serviceToken = process.env.BRAINTRUST_SERVICE_TOKEN;
      if (!serviceToken) {
        throw new Error("BRAINTRUST_SERVICE_TOKEN is required in CI.");
      }

      const target = await discoverTestTarget(serviceToken);
      const home = await mkdtemp(join(tmpdir(), "braintrust-cli-test-"));

      try {
        const runtime = createBraintrustCliRuntime({
          env: {
            ...process.env,
            HOME: home,
            XDG_CONFIG_HOME: join(home, ".config"),
          },
        });
        const discovery = await runtime.discover();

        expect(discovery).toMatchObject({ installed: true });
        expect(discovery.commandPath).toBeDefined();
        expect(discovery.version).toBeDefined();

        await runtime.loginAndSwitch(discovery.commandPath!, {
          apiKey: serviceToken,
          apiUrl: target.apiUrl,
          appUrl: DEFAULT_APP_URL,
          orgName: target.orgName,
          projectName: target.projectName,
        });

        await expect(
          runtime.status(discovery.commandPath!),
        ).resolves.toMatchObject({
          profile: target.orgName,
          org: target.orgName,
          project: target.projectName,
        });
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

async function discoverTestTarget(serviceToken: string): Promise<{
  readonly apiUrl: string;
  readonly orgName: string;
  readonly projectName: string;
}> {
  const loginUrl = new URL("/api/apikey/login", DEFAULT_APP_URL);
  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceToken}` },
  });
  if (!loginResponse.ok) {
    throw new Error(`Braintrust login failed with ${loginResponse.status}.`);
  }

  const login = (await loginResponse.json()) as {
    readonly org_info?: readonly {
      readonly name: string;
      readonly api_url?: string | null;
    }[];
  };
  const org = login.org_info?.[0];
  if (!org) throw new Error("The CI service token has no Braintrust org.");

  const apiUrl = org.api_url ?? DEFAULT_API_URL;
  const projectsUrl = new URL("/v1/project", apiUrl);
  projectsUrl.searchParams.set("org_name", org.name);
  const projectsResponse = await fetch(projectsUrl, {
    headers: { Authorization: `Bearer ${serviceToken}` },
  });
  if (!projectsResponse.ok) {
    throw new Error(
      `Braintrust project lookup failed with ${projectsResponse.status}.`,
    );
  }

  const projects = (await projectsResponse.json()) as {
    readonly objects?: readonly { readonly name: string }[];
  };
  const project = projects.objects?.[0];
  if (!project) {
    throw new Error("The CI service token's Braintrust org has no project.");
  }

  return { apiUrl, orgName: org.name, projectName: project.name };
}
