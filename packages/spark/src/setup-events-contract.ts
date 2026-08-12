export type CliSetupEntryPoint =
  | "homepage"
  | "in_app_onboarding"
  | "in_app_setup"
  | "docs"
  | "direct";

export const CLI_SETUP_DOCS_PAGES = [
  "tracing_quickstart",
  "csharp_quickstart",
  "go_quickstart",
  "java_quickstart",
  "python_quickstart",
  "ruby_quickstart",
  "typescript_quickstart",
] as const;

export type CliSetupDocsPage = (typeof CLI_SETUP_DOCS_PAGES)[number];
export type CliSetupAuthMode = "signin" | "signup" | "ci";
export type CliSetupAgentMarker =
  | "amp"
  | "antigravity"
  | "augment"
  | "claude_code"
  | "codex"
  | "cursor"
  | "devin"
  | "gemini_cli"
  | "github_copilot"
  | "goose"
  | "opencode"
  | "other"
  | "replit";

export type CliSetupClientContext = {
  readonly cliVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly entryPoint: CliSetupEntryPoint;
  readonly docsPage?: CliSetupDocsPage | undefined;
  readonly authMode?: CliSetupAuthMode | undefined;
  readonly agentMarker?: CliSetupAgentMarker | undefined;
};
