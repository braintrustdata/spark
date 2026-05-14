import yargs from "yargs/yargs";

export type WizardOptions = {
  readonly apiUrl: string;
  readonly appUrl: string;
  readonly caCertPath: string | undefined;
};

const DEFAULT_API_URL = "https://api.braintrust.dev";
const DEFAULT_APP_URL = "https://www.braintrust.dev";

function buildParser(env: NodeJS.ProcessEnv) {
  return yargs([])
    .scriptName("bt-wizard")
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
    .epilog(
      "Environment:\n  CRANK_ENABLE_TELEMETRY=false   Disable anonymous usage telemetry",
    )
    .help()
    .alias("h", "help")
    .strict();
}

export async function helpText(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return buildParser(env).getHelp();
}

export async function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<WizardOptions> {
  const parser = buildParser(env);
  const parsed = await parser.parseAsync([...argv]);

  return {
    apiUrl: stripTrailingSlash(parsed["api-url"] as string),
    appUrl: stripTrailingSlash(parsed["app-url"] as string),
    caCertPath: (parsed["ca-cert"] as string | undefined) || undefined,
  };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
