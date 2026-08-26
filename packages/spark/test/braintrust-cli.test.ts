import { describe, expect, it } from "vitest";

import { createBraintrustCliRuntime } from "../src/braintrust-cli";

describe("Braintrust CLI runtime", () => {
  it("builds the Unix installer command", async () => {
    const calls: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly env?: NodeJS.ProcessEnv;
    }> = [];
    const runtime = createBraintrustCliRuntime({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      exec: (spec) => {
        calls.push(spec);
        return Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
        });
      },
    });

    await runtime.install();

    expect(calls).toEqual([
      {
        command: "sh",
        args: [
          "-c",
          "curl -fsSL https://bt.dev/cli/install.sh | bash -s -- --quiet",
        ],
        env: { PATH: "/usr/bin" },
      },
    ]);
  });

  it("builds the update command", async () => {
    const calls: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly env?: NodeJS.ProcessEnv;
    }> = [];
    const runtime = createBraintrustCliRuntime({
      env: { PATH: "/usr/bin" },
      exec: (spec) => {
        calls.push(spec);
        return Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
        });
      },
    });

    await runtime.update("/usr/local/bin/bt");

    expect(calls).toEqual([
      {
        command: "/usr/local/bin/bt",
        args: ["self", "update"],
        env: { PATH: "/usr/bin" },
      },
    ]);
  });

  it("passes the API key only through env when configuring auth and context", async () => {
    const calls: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly env?: NodeJS.ProcessEnv;
    }> = [];
    const runtime = createBraintrustCliRuntime({
      env: { PATH: "/usr/bin" },
      exec: (spec) => {
        calls.push(spec);
        return Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
        });
      },
    });

    await runtime.loginAndSwitch("/usr/local/bin/bt", {
      apiKey: "bt-secret-key",
      apiUrl: "https://api.test",
      appUrl: "https://app.test",
      orgName: "acme",
      projectName: "demo",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual([
      "login",
      "--profile=acme",
      "--org=acme",
      "--no-input",
      "--quiet",
    ]);
    expect(calls[1]?.args).toEqual([
      "switch",
      "--profile=acme",
      "--org=acme",
      "--no-input",
      "--quiet",
      "--global",
      "demo",
    ]);
    expect(calls.flatMap((call) => [...call.args])).not.toContain(
      "bt-secret-key",
    );
    expect(calls[0]?.env?.["BRAINTRUST_API_KEY"]).toBe("bt-secret-key");
    expect(calls[0]?.env?.["BRAINTRUST_API_URL"]).toBe("https://api.test");
    expect(calls[0]?.env?.["BRAINTRUST_APP_URL"]).toBe("https://app.test");
    expect(calls[1]?.env?.["BRAINTRUST_API_KEY"]).toBe("bt-secret-key");
  });

  it("parses bt status JSON", async () => {
    const runtime = createBraintrustCliRuntime({
      exec: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: JSON.stringify({
            profile: "work",
            org: "acme",
            project: "demo",
          }),
          stderr: "",
        }),
    });

    await expect(runtime.status("/bin/bt")).resolves.toEqual({
      profile: "work",
      org: "acme",
      project: "demo",
    });
  });
});
