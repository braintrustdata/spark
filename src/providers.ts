/**
 * LLM providers shown in the wizard. The list mirrors the API-key entries in
 * `AISecretTypes` from `@braintrust/proxy/schema` — the providers users
 * configure with a single API key. Cloud providers (Bedrock, Vertex, Azure,
 * Databricks) use multi-field credentials and are intentionally excluded.
 *
 * Drift is enforced by `test/providers.test.ts`, which imports
 * `@braintrust/proxy/schema` (devDep) and asserts equality against this list.
 *
 * If `custom: true`, no API key is requested and instrumentation is skipped.
 */
export type LlmProvider = {
  readonly id: string;
  readonly label: string;
  readonly envVar?: string;
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
  { id: "custom", label: "Custom (self-hosted, skip API key)", custom: true },
];
