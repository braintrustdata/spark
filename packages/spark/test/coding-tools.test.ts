import { describe, expect, it } from "vitest";

import {
  buildClaudeCommandForTest,
  buildCodexCommandForTest,
  buildToolUnavailableMessage,
  parseClaudeEventForTest,
  parseClaudeEventsForTest,
  parseClaudeStatusForTest,
  parseCodexEventForTest,
  parseCodexStatusForTest,
} from "../src/coding-tools";

const CWD = "/repo";

describe("coding tool status parsing", () => {
  it("accepts Claude Code subscription auth", () => {
    const status = parseClaudeStatusForTest({
      commandPath: "/bin/claude",
      version: "2.1.84 (Claude Code)",
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        subscriptionType: "pro",
      }),
    });

    expect(status.usable).toBe(true);
    expect(status.authMode).toBe("claude.ai (pro)");
  });

  it("accepts Claude Code token auth without a subscription field", () => {
    const status = parseClaudeStatusForTest({
      commandPath: "/bin/claude",
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "apiKey",
      }),
    });

    expect(status.usable).toBe(true);
    expect(status.authMode).toBe("apiKey");
  });

  it("rejects Claude Code when logged out", () => {
    const status = parseClaudeStatusForTest({
      commandPath: "/bin/claude",
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ loggedIn: false }),
    });

    expect(status.usable).toBe(false);
    expect(status.unavailableReason).toMatch(/not logged in/i);
  });

  it("accepts Codex login status", () => {
    const status = parseCodexStatusForTest({
      commandPath: "/bin/codex",
      version: "codex-cli 0.133.0",
      exitCode: 0,
      stderr: "",
      stdout: "Logged in using ChatGPT\n",
    });

    expect(status.usable).toBe(true);
    expect(status.authMode).toBe("ChatGPT");
  });

  it("accepts Codex login text even when the status command exits nonzero", () => {
    const status = parseCodexStatusForTest({
      commandPath: "/bin/codex",
      version: "codex-cli 0.133.0",
      exitCode: 1,
      stderr: "",
      stdout: "Logged in using ChatGPT\n",
    });

    expect(status.usable).toBe(true);
    expect(status.authMode).toBe("ChatGPT");
  });

  it("rejects Codex failed login status", () => {
    const status = parseCodexStatusForTest({
      commandPath: "/bin/codex",
      exitCode: 1,
      stderr: "Not logged in\n",
      stdout: "",
    });

    expect(status.usable).toBe(false);
    expect(status.unavailableReason).toBe("Not logged in");
  });

  it("formats missing tool messages", () => {
    expect(
      buildToolUnavailableMessage({
        id: "claude",
        label: "Claude Code",
        command: "claude",
        installed: false,
        usable: false,
      }),
    ).toBe("Claude Code is not installed.");
  });
});

describe("coding tool command construction", () => {
  it("builds autonomous Claude Code command", () => {
    const spec = buildClaudeCommandForTest({
      commandPath: "/bin/claude",
      cwd: CWD,
      prompt: "prompt",
      env: {},
    });

    expect(spec.command).toBe("/bin/claude");
    expect(spec.args).toContain("--output-format");
    expect(spec.args).toContain("stream-json");
    expect(spec.args).toContain("acceptEdits");
    expect(spec.args).toContain("--allowedTools");
    expect(spec.stdin).toBe("prompt");
  });

  it("builds autonomous Codex command", () => {
    const spec = buildCodexCommandForTest({
      commandPath: "/bin/codex",
      cwd: CWD,
      prompt: "prompt",
      env: {},
    });

    expect(spec.command).toBe("/bin/codex");
    expect(spec.args).toContain("--json");
    expect(spec.args).toContain("workspace-write");
    expect(spec.args).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(spec.args.at(-1)).toBe("-");
    expect(spec.stdin).toBe("prompt");
  });
});

describe("coding tool event normalization", () => {
  it("normalizes Claude file reads and edits", () => {
    const readEvent = parseClaudeEventForTest(
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/repo/src/app.ts" },
            },
          ],
        },
      },
      CWD,
    );
    expect(readEvent).toMatchObject({
      type: "reading",
      message: "Reading src/app.ts",
      toolInput: "file_path: src/app.ts",
      toolName: "Read",
    });

    const editEvent = parseClaudeEventForTest(
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/repo/src/app.ts" },
            },
          ],
        },
      },
      CWD,
    );
    expect(editEvent).toMatchObject({
      type: "editing",
      message: "Editing src/app.ts",
      toolInput: "file_path: src/app.ts",
      toolName: "Edit",
    });
  });

  it("normalizes every Claude tool use in one assistant message", () => {
    const events = parseClaudeEventsForTest(
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/repo/package.json" },
            },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/repo/src/app.ts" },
            },
          ],
        },
      },
      CWD,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      message: "Reading package.json",
      type: "reading",
    });
    expect(events[1]).toMatchObject({
      message: "Editing src/app.ts",
      type: "editing",
    });
  });

  it("normalizes Codex command executions", () => {
    expect(
      parseCodexEventForTest(
        {
          type: "item.started",
          item: {
            type: "command_execution",
            command: "pnpm test",
            status: "in_progress",
          },
        },
        CWD,
      ),
    ).toMatchObject({
      type: "running",
      message: "Running pnpm test",
      toolInput: "command: pnpm test",
      toolName: "command_execution",
    });
  });
});
