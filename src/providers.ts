/**
 * LLM providers shown in the wizard.
 *
 * Single-key providers (most): set `envVar` — one API key is collected and
 * passed to the harness as that env var. The list of single-key providers
 * mirrors `AISecretTypes` from `@braintrust/proxy/schema`; drift is enforced
 * by `test/providers.test.ts`.
 *
 * Multi-credential providers (Bedrock, Vertex, Azure): set `credentials` with
 * one entry per env var. Each field is prompted individually; all are passed
 * to the harness.
 *
 * If `custom: true`, no credentials are requested and instrumentation is
 * skipped.
 */
export type CredentialField = {
  readonly envVar: string;
  readonly label: string;
  readonly secret?: boolean;
};

export type LlmProvider = {
  readonly id: string;
  readonly label: string;
  /** Single-key providers: the env var for the API key. */
  readonly envVar?: string;
  /** Multi-credential providers: one entry per env var to collect. */
  readonly credentials?: readonly CredentialField[];
  readonly custom?: boolean;
};

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "gemini", label: "Gemini", envVar: "GEMINI_API_KEY" },
  { id: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY" },
  { id: "together", label: "Together.ai", envVar: "TOGETHER_API_KEY" },
  { id: "fireworks", label: "Fireworks", envVar: "FIREWORKS_API_KEY" },
  { id: "perplexity", label: "Perplexity", envVar: "PERPLEXITY_API_KEY" },
  { id: "xai", label: "xAI", envVar: "XAI_API_KEY" },
  { id: "groq", label: "Groq", envVar: "GROQ_API_KEY" },
  { id: "lepton", label: "Lepton", envVar: "LEPTON_API_KEY" },
  { id: "cerebras", label: "Cerebras", envVar: "CEREBRAS_API_KEY" },
  { id: "replicate", label: "Replicate", envVar: "REPLICATE_API_KEY" },
  { id: "baseten", label: "Baseten", envVar: "BASETEN_API_KEY" },
  {
    id: "bedrock",
    label: "AWS Bedrock",
    credentials: [
      { envVar: "AWS_ACCESS_KEY_ID", label: "Access Key ID" },
      {
        envVar: "AWS_SECRET_ACCESS_KEY",
        label: "Secret Access Key",
        secret: true,
      },
      { envVar: "AWS_REGION", label: "Region" },
    ],
  },
  {
    id: "vertex",
    label: "Google Vertex AI",
    credentials: [
      { envVar: "GOOGLE_CLOUD_PROJECT", label: "Project ID" },
      { envVar: "GOOGLE_CLOUD_LOCATION", label: "Location (e.g. us-central1)" },
      {
        envVar: "GOOGLE_APPLICATION_CREDENTIALS",
        label: "Path to service account JSON",
      },
    ],
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    credentials: [
      { envVar: "AZURE_OPENAI_API_KEY", label: "API Key", secret: true },
      { envVar: "AZURE_OPENAI_ENDPOINT", label: "Endpoint URL" },
      { envVar: "AZURE_OPENAI_DEPLOYMENT", label: "Deployment name" },
    ],
  },
  { id: "custom", label: "Custom (self-hosted, skip API key)", custom: true },
];
