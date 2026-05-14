import type { DetectedLanguage } from "./language-detect";

/*
 * spark agent prompt
 * Adapt the link to the docs given depending on the language to instrument
 * Instructs the agent to say INSTRUMENTATION_(IN)COMPLETE after it has completed the task.
 * The harness catches these words and close the agent.
 * This is non deterministic but knowing instrumentation is done is non deterministic too, I didn't think of a better solution.
 */
const TEMPLATE = `# Braintrust SDK Installation (Agent Instructions)

## Hard Rules

{RUN_MODE_CONTEXT}

- **Only add Braintrust code.** Do not refactor or modify unrelated code.
- **One language, one service per install run.** If the repo has more than one candidate, ask the user which one to instrument before starting. Do not instrument multiple languages or services in the same run.
- **If the language is unclear, ask the user.** Do not guess. See Step 2.
- **Install the latest Braintrust SDK.** Do not hard-pin the Braintrust SDK version unless the user asks for it -- use the package manager's normal install (which may produce an exact or a ranged version, whichever is idiomatic for that ecosystem). Build-time dependencies (e.g. Orchestrion for Go) must still be pinned to an exact version -- see the language-specific resource.
- **Set the project name in code.** Do NOT configure project name via env vars.
- **App must run without Braintrust.** If \`BRAINTRUST_API_KEY\` is missing at runtime, do not crash.
- **Do not guess APIs.** Use official documentation/examples only.
- **Do not add eval code** unless explicitly requested.
- **Do not add manual flush/shutdown logic** unless the app is a short-lived script, serverless function, Lambda, or CLI that exits immediately after LLM calls -- in which case a single \`flush()\` (or language equivalent) right before exit is correct, since otherwise traces get dropped. Do not add flush/shutdown for long-running processes (servers, daemons, workers).
- **If SDK is already installed/configured, do not duplicate work.**
- **Do not create setup-only files or directories in the repo.** Do not write \`.bt/setup/\`, \`.bt/skills/docs/\`, agent skill directories, or setup task files unless explicitly asked by the user.

---

## Execution Requirements

Before writing any code:

1. Create a **checklist** from the steps below.
2. Execute each step in order.
3. Do not skip steps.

---

## Steps

{LANGUAGE_CONTEXT}

---

{INSTALL_SDK_CONTEXT}

---

### 4. Verify Installation (MANDATORY)

- If the SDK relies on build-time or launch-time auto-instrumentation, make sure the project's normal build/run path now uses it. A one-off verification command is not sufficient.
- Run the application.
- Confirm at least one log/trace is emitted to Braintrust.
- Confirm no runtime errors.
- Confirm the app still runs if \`BRAINTRUST_API_KEY\` is unset.

If you do not know how to run the app, ask the user and wait for the response before proceeding.

---

### 5. Final Summary

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

const LANGUAGE_DISPLAY: Record<DetectedLanguage, string> = {
  python: "Python",
  typescript: "TypeScript",
  go: "Go",
  java: "Java",
  ruby: "Ruby",
  csharp: "C#",
};

const SDK_INSTALL_DOCS_BASE =
  "https://www.braintrust.dev/docs/instrument/trace-llm-calls";

const INSTALL_SDK_REQUIREMENTS = `- Install the latest Braintrust SDK via the language's package manager. Do not hard-pin the SDK version unless the user asks. Build-time dependencies called out by the language-specific resource (e.g. Orchestrion for Go) must still be pinned to an exact version.
- Modify only dependency files, a minimal application entry point (e.g., main/bootstrap), and any existing build/run scripts or checked-in env/config that must change to keep auto-instrumentation active in normal use. Auto-instrument the app (except for Java and C# which don't support auto-instrumentation).
- Do not change unrelated code.`;

const DETECT_LANGUAGE_BLOCK = `### 2. Detect Language

**Instrument exactly one language/service per install run.** Do not install Braintrust for multiple languages or multiple services in the same run, even if the repo contains more than one. If more than one candidate exists, stop and ask the user which single service to instrument before doing anything else.

Determine the project language using concrete signals:

- \`package.json\` -> TypeScript
- \`requirements.txt\`, \`setup.py\` or \`pyproject.toml\` -> Python
- \`pom.xml\` or \`build.gradle\` -> Java
- \`go.mod\` -> Go
- \`Gemfile\` -> Ruby
- \`.csproj\` -> C#

**If exactly one of these matches at the repo root and there is no ambiguity, proceed with that language.**

In every other case, **stop and ask the user** before continuing. Do not guess, do not pick the "most likely" language, and do not instrument more than one.`;

export type RenderPromptOptions = {
  readonly languages: readonly DetectedLanguage[];
  readonly interactive: boolean;
  /**
   * If set, a path the agent must write the trace permalink to (single line,
   * just the URL) right before exiting. The wizard reads this file after the
   * harness exits and surfaces the permalink in its cleanup message.
   */
  readonly resultFilePath?: string;
};

export function renderPrompt(opts: RenderPromptOptions): string {
  const runMode = opts.interactive
    ? "- **Interactive mode:** You can ask the user questions through the chat interface.\n"
    : "- **Non-interactive mode:** You cannot ask the user questions. If a step requires user input (e.g., ambiguous language in a polyglot repo, unknown run command), abort with a clear explanation of what is needed.\n";

  let languageContext: string;
  let installSdkContext: string;

  if (opts.languages.length === 0) {
    languageContext = DETECT_LANGUAGE_BLOCK;
    const rows = (Object.keys(LANGUAGE_DISPLAY) as DetectedLanguage[])
      .map(
        (lang) =>
          `| ${LANGUAGE_DISPLAY[lang]} | \`${SDK_INSTALL_DOCS_BASE}#${lang}\` |`,
      )
      .join("\n");
    installSdkContext = `### 3. Install SDK (Language-Specific)

Read the install guide for the detected language from the canonical docs:

| Language | Doc URL |
| -------- | ------- |
${rows}

Requirements:

${INSTALL_SDK_REQUIREMENTS}`;
  } else if (opts.languages.length === 1) {
    const lang = opts.languages[0]!;
    languageContext = `### 2. Language

The target language has been specified: **${LANGUAGE_DISPLAY[lang]}**.`;
    installSdkContext = `### 3. Install SDK

Read the install guide from the canonical docs: \`${SDK_INSTALL_DOCS_BASE}#${lang}\`

Requirements:

${INSTALL_SDK_REQUIREMENTS}`;
  } else {
    const list = opts.languages
      .map((l) => `**${LANGUAGE_DISPLAY[l]}**`)
      .join(", ");
    languageContext = `### 2. Language

Candidate languages detected: ${list}. Pick exactly one with the user before proceeding.`;
    const rows = opts.languages
      .map(
        (l) => `| ${LANGUAGE_DISPLAY[l]} | \`${SDK_INSTALL_DOCS_BASE}#${l}\` |`,
      )
      .join("\n");
    installSdkContext = `### 3. Install SDK

Read the install guide for the chosen language from the canonical docs:

| Language | Doc URL |
| -------- | ------- |
${rows}

Requirements:

${INSTALL_SDK_REQUIREMENTS}`;
  }

  const resultFileContext = opts.resultFilePath
    ? `## Reporting the Trace Permalink (REQUIRED)

When you have obtained the Braintrust trace permalink in the Final Summary step, write it as plain text (just the URL, no surrounding text, single line) to this exact file path before finishing:

\`${opts.resultFilePath}\`

Use the \`write\` tool. The wizard reads this file after you exit and surfaces the permalink to the user. If you cannot produce a permalink, leave the file empty.

`
    : "";

  const workflowContext = `## Latest Braintrust Setup Docs

Use the canonical Braintrust docs at https://www.braintrust.dev/docs as the source of truth for SDK setup behavior. Prefer local \`bt\` CLI commands over direct API calls when verifying state.`;

  return TEMPLATE.replace("{RUN_MODE_CONTEXT}", runMode)
    .replace("{LANGUAGE_CONTEXT}", languageContext)
    .replace("{INSTALL_SDK_CONTEXT}", installSdkContext)
    .replace("{RESULT_FILE_CONTEXT}", resultFileContext)
    .replace("{WORKFLOW_CONTEXT}", workflowContext);
}
