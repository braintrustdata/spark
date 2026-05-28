export type RenderPromptOptions = {
  readonly orgName?: string;
  readonly projectName?: string;
  /**
   * When true, instruct the agent to write the trace permalink to the path in
   * the `BT_WIZARD_RESULT_FILE` env var before exiting. The wizard sets that
   * env var and reads the file after the coding tool exits.
   */
  readonly includeResultFile?: boolean;
};

const RESULT_FILE_BLOCK = `## Reporting the Trace Permalink (REQUIRED)

When you have obtained the Braintrust trace permalink in the Final Summary step, write it as plain text (just the URL, no surrounding text, single line) to the file path in the \`BT_WIZARD_RESULT_FILE\` environment variable before finishing.

Use an available file editing tool or shell command to write it. The wizard reads this file after you exit and surfaces the permalink to the user. If you cannot produce a permalink, leave the file empty.

`;

export function renderPrompt(opts: RenderPromptOptions): string {
  const target =
    opts.orgName || opts.projectName
      ? `\n## Braintrust Target\n\n${opts.orgName ? `- Organization: ${opts.orgName}\n` : ""}${opts.projectName ? `- Project name to set in code: ${opts.projectName}\n` : ""}`
      : "";

  const resultFile = opts.includeResultFile ? RESULT_FILE_BLOCK : "";

  return `# Braintrust SDK Installation (Agent Instructions)

## Hard Rules

${target}
- **Only add Braintrust code.** Do not refactor or modify unrelated code.
- **Resolve ambiguity from the repository, ask only when blocked.** If you have a chat or interactive channel with the user, ask when you cannot reasonably infer an answer. Otherwise pick the most likely option from repository evidence (dominant language, conventional run command, etc.) and proceed.
- **One app/service per install run.** Inspect the repository and choose the single clear target application.
- **Install the latest Braintrust SDK.** Use the repository's package manager and the official Braintrust SDK docs. Do not hard-pin the Braintrust SDK version unless the user asks for it.
- **Set the project name in code.** Do NOT configure project name via env vars.
- **App must run without Braintrust.** If \`BRAINTRUST_API_KEY\` is missing at runtime, do not crash.
- **Do not guess APIs.** Use official documentation/examples only.
- **Do not add eval code** unless explicitly requested.
- **Do not add manual flush/shutdown logic** unless the app is a short-lived script, serverless function, Lambda, or CLI that exits immediately after LLM calls -- in which case a single \`flush()\` (or language equivalent) right before exit is correct, since otherwise traces get dropped. Do not add flush/shutdown for long-running processes (servers, daemons, workers).
- **If SDK is already installed/configured, do not duplicate work.**
- **Do not create setup-only files or directories in the repo.** Do not write \`.bt/setup/\`, \`.bt/skills/docs/\`, agent skill directories, or setup task files unless explicitly asked by the user.
- **Respect tool boundaries.** Reading files and searching documentation is allowed. Write or edit files only in the current working directory and its descendants. Do not modify parent directories, home-directory config, global tool config, or unrelated repositories.
- **Avoid destructive commands.** Do not delete files, reset git state, clean the repo, commit, push, tag, release, or run broad filesystem mutation commands. Use package-manager install/build/test commands only when needed for this instrumentation task.

---

## Steps

### 1. Inspect Project

- Identify the single app/service to instrument from repository evidence.
- Identify its language, framework, dependency manager, and normal build/run path.

---

### 2. Install SDK

Read the official Braintrust SDK docs at https://www.braintrust.dev/docs/instrument/trace-llm-calls and follow the relevant instructions for this repository.

Modify only dependency files, a minimal application entry point (e.g., main/bootstrap), and any existing build/run scripts or checked-in env/config that must change to keep instrumentation active in normal use. If the SDK is already installed/configured, do not duplicate work.

---

### 3. Verify Installation (MANDATORY)

- If the SDK relies on build-time or launch-time auto-instrumentation, make sure the project's normal build/run path now uses it. A one-off verification command is not sufficient.
- Run the application.
- Confirm at least one log/trace is emitted to Braintrust.
- Confirm no runtime errors.
- Confirm the app still runs if \`BRAINTRUST_API_KEY\` is unset.

---

### 4. Final Summary

Summarize:

- What SDK version was installed
- Where code was modified
- What logs/traces were emitted
- The Braintrust permalink (required). Format: \`https://www.braintrust.dev/app/{org}/p/{project}/logs?r={root_span_id}\` (substitute your self-hosted \`BRAINTRUST_APP_URL\` if not on SaaS). The \`r\` parameter is the root span id of the emitted trace.

${resultFile}`;
}
