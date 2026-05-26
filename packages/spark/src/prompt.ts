/*
 * Braintrust setup agent prompt
 * Instructs the agent to say INSTRUMENTATION_(IN)COMPLETE after it has completed the task.
 * The setup wizard watches these words and surfaces a concise completion
 * summary after the selected coding tool exits.
 */
const SDK_DOCS_URL =
  "https://www.braintrust.dev/docs/instrument/trace-llm-calls";

const TEMPLATE = `# Braintrust SDK Installation (Agent Instructions)

## Hard Rules

{RUN_MODE_CONTEXT}
{TARGET_CONTEXT}

- **Only add Braintrust code.** Do not refactor or modify unrelated code.
- **Do not ask the terminal user questions.** This run is non-interactive.
- **One app/service per install run.** Inspect the repository and choose the single clear target application. If there is no clear target, stop and report \`INSTRUMENTATION_INCOMPLETE\`.
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

## Execution Requirements

Before writing any code:

1. Create a **checklist** from the steps below.
2. Execute each step in order.
3. Do not skip steps.

---

## Steps

### 1. Inspect Project

- Identify the single app/service to instrument from repository evidence.
- Identify its language, framework, dependency manager, and normal build/run path.
- If the target app/service is ambiguous, stop and report \`INSTRUMENTATION_INCOMPLETE\`.

---

### 2. Install SDK

Read the official Braintrust SDK docs and follow the relevant instructions for this repository:

\`${SDK_DOCS_URL}\`

Modify only dependency files, a minimal application entry point (e.g., main/bootstrap), and any existing build/run scripts or checked-in env/config that must change to keep instrumentation active in normal use. If the SDK is already installed/configured, do not duplicate work.

---

### 3. Verify Installation (MANDATORY)

- If the SDK relies on build-time or launch-time auto-instrumentation, make sure the project's normal build/run path now uses it. A one-off verification command is not sufficient.
- Run the application.
- Confirm at least one log/trace is emitted to Braintrust.
- Confirm no runtime errors.
- Confirm the app still runs if \`BRAINTRUST_API_KEY\` is unset.

If you do not know how to run the app, stop with \`INSTRUMENTATION_INCOMPLETE\` and explain what information is needed.

---

### 4. Final Summary

Summarize:

- What SDK version was installed
- Where code was modified
- What logs/traces were emitted
- The Braintrust permalink (required)

If instrumentation succeeded, output the following sentinel on its own line exactly as written:

INSTRUMENTATION_COMPLETE

If instrumentation failed or could not be completed, output instead:

INSTRUMENTATION_INCOMPLETE

{RESULT_FILE_CONTEXT}{WORKFLOW_CONTEXT}
`;

export type RenderPromptOptions = {
  readonly interactive: boolean;
  readonly yolo?: boolean;
  readonly orgName?: string;
  readonly projectName?: string;
  /**
   * If set, a path the agent must write the trace permalink to (single line,
   * just the URL) right before exiting. The wizard reads this file after the
   * coding tool exits and surfaces the permalink in its cleanup message.
   */
  readonly resultFilePath?: string;
};

export function renderPrompt(opts: RenderPromptOptions): string {
  let runMode: string;
  if (opts.yolo) {
    runMode =
      "- **Unattended mode (YOLO):** There is no user available to answer questions. Do not stop, do not wait, and do not request input. Make the most reasonable choice from the evidence in the repo (pick the dominant language, use a conventional run command, etc.) and proceed. Only output `INSTRUMENTATION_INCOMPLETE` if instrumentation is genuinely impossible without input you cannot infer.\n";
  } else if (opts.interactive) {
    runMode =
      "- **Interactive mode:** You can ask the user questions through the chat interface.\n";
  } else {
    runMode =
      "- **Non-interactive mode:** You cannot ask the user questions. If a step requires user input (e.g., ambiguous language in a polyglot repo, unknown run command), stop with `INSTRUMENTATION_INCOMPLETE` and explain what is needed.\n";
  }

  const targetContext =
    opts.projectName || opts.orgName
      ? `\n## Braintrust Target\n\n${opts.orgName ? `- Organization: ${opts.orgName}\n` : ""}${opts.projectName ? `- Project name to set in code: ${opts.projectName}\n` : ""}`
      : "";

  const resultFileContext = opts.resultFilePath
    ? `## Reporting the Trace Permalink (REQUIRED)

When you have obtained the Braintrust trace permalink in the Final Summary step, write it as plain text (just the URL, no surrounding text, single line) to this exact file path before finishing:

\`${opts.resultFilePath}\`

Use an available file editing tool or shell command to write it. The wizard reads this file after you exit and surfaces the permalink to the user. If you cannot produce a permalink, leave the file empty.

`
    : "";

  const workflowContext = `## Latest Braintrust Setup Docs

Use the official Braintrust SDK docs at ${SDK_DOCS_URL} as the source of truth for SDK setup behavior.`;

  return TEMPLATE.replace("{RUN_MODE_CONTEXT}", runMode)
    .replace("{TARGET_CONTEXT}", targetContext)
    .replace("{RESULT_FILE_CONTEXT}", resultFileContext)
    .replace("{WORKFLOW_CONTEXT}", workflowContext);
}
