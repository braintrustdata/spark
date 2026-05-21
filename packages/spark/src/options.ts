import yargs from "yargs/yargs";

import pkg from "../package.json" with { type: "json" };
import { LLM_PROVIDERS, type LlmProvider } from "./providers";

export type WizardOptions = {
  readonly apiUrl: string;
  readonly appUrl: string;
  readonly caCertPath: string | undefined;
  readonly apiKey: string | undefined;
  readonly projectId: string | undefined;
  readonly instrument: boolean;
  readonly yolo: boolean;
  readonly provider: LlmProvider | undefined;
  readonly providerApiKey: string | undefined;
};

const DEFAULT_API_URL = "https://api.braintrust.dev";
const DEFAULT_APP_URL = "https://www.braintrust.dev";

function buildParser(env: NodeJS.ProcessEnv) {
  return yargs([])
    .scriptName("spark")
    .usage("$0 [options]")
    .option("api-url", {
      type: "string",
      description: "Override API URL",
      default: env["BRAINTRUST_API_URL"] ?? DEFAULT_API_URL,
    })
    .option("app-url", {
      type: "string",
      description: "Override app URL",
      default: env["BRAINTRUST_APP_URL"] ?? DEFAULT_APP_URL,
    })
    .option("ca-cert", {
      type: "string",
      description: "Path to PEM CA bundle",
      default: env["BRAINTRUST_CA_CERT"] ?? env["SSL_CERT_FILE"],
    })
    .help()
    .alias("h", "help")
    .version(pkg.version)
    .strict();
}

function readEnvString(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const v = env[name];
  return v && v.length > 0 ? v : undefined;
}

function readEnvBool(env: NodeJS.ProcessEnv, name: string): boolean {
  const v = env[name];
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export async function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<WizardOptions> {
  const parser = buildParser(env);
  const parsed = await parser.parseAsync([...argv]);

  const apiKey = readEnvString(env, "BRAINTRUST_SPARK_API_KEY");
  const projectId = readEnvString(env, "BRAINTRUST_SPARK_PROJECT_ID");

  if ((apiKey === undefined) !== (projectId === undefined)) {
    throw new Error(
      "BRAINTRUST_SPARK_API_KEY and BRAINTRUST_SPARK_PROJECT_ID must both be set together",
    );
  }

  const yolo = readEnvBool(env, "BRAINTRUST_SPARK_YOLO");

  const providerId = readEnvString(env, "BRAINTRUST_SPARK_PROVIDER");
  const providerApiKey = readEnvString(
    env,
    "BRAINTRUST_SPARK_PROVIDER_API_KEY",
  );

  let provider: LlmProvider | undefined;
  if (providerId !== undefined) {
    const match = LLM_PROVIDERS.find((p) => p.id === providerId);
    if (!match) {
      const known = LLM_PROVIDERS.map((p) => p.id).join(", ");
      throw new Error(
        `Unknown BRAINTRUST_SPARK_PROVIDER "${providerId}". Known providers: ${known}`,
      );
    }
    provider = match;
  }

  if (providerApiKey !== undefined) {
    if (!provider) {
      throw new Error(
        "BRAINTRUST_SPARK_PROVIDER_API_KEY requires BRAINTRUST_SPARK_PROVIDER",
      );
    }
  }

  return {
    apiUrl: stripTrailingSlash(parsed["api-url"] as string),
    appUrl: stripTrailingSlash(parsed["app-url"] as string),
    caCertPath: (parsed["ca-cert"] as string | undefined) || undefined,
    apiKey,
    projectId,
    instrument: readEnvBool(env, "BRAINTRUST_SPARK_INSTRUMENT") || yolo,
    yolo,
    provider,
    providerApiKey,
  };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
