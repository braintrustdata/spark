import yargs from "yargs/yargs";

import pkg from "../package.json" with { type: "json" };

export type WizardOptions = {
  readonly apiUrl: string;
  readonly appUrl: string;
  readonly apiKey: string | undefined;
  readonly projectId: string | undefined;
  readonly orgId: string | undefined;
  readonly projId: string | undefined;
  readonly yolo: boolean;
};

export const DEFAULT_API_URL = "https://api.braintrust.dev";
export const DEFAULT_APP_URL = "https://www.braintrust.dev";

function buildParser(env: NodeJS.ProcessEnv) {
  return yargs([])
    .scriptName("braintrust-setup")
    .usage("$0 [options]")
    .option("api-url", {
      type: "string",
      description: "Override API URL",
      default: readEnvString(env, "BRAINTRUST_API_URL") ?? DEFAULT_API_URL,
      hidden: true,
    })
    .option("app-url", {
      type: "string",
      description: "Override app URL",
      default: DEFAULT_APP_URL,
      hidden: true,
    })
    .option("org-id", {
      type: "string",
      description: "Braintrust org ID to pass to browser sign-in",
      default: readEnvString(env, "BRAINTRUST_ORG_ID"),
    })
    .option("proj-id", {
      type: "string",
      description: "Braintrust project ID to pass to browser sign-in",
      default: readEnvString(env, "BRAINTRUST_PROJ_ID"),
    })
    .option("setup-api-key", {
      type: "string",
      hidden: true,
    })
    .option("setup-project-id", {
      type: "string",
      hidden: true,
    })
    .option("setup-yolo", {
      type: "boolean",
      hidden: true,
    })
    .help()
    .alias("h", "help")
    .version(pkg.version)
    .strict(false);
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

  const apiKey = readEnvString(env, "BRAINTRUST_SETUP_API_KEY");
  const projectId = readEnvString(env, "BRAINTRUST_SETUP_PROJECT_ID");

  if ((apiKey === undefined) !== (projectId === undefined)) {
    throw new Error(
      "BRAINTRUST_SETUP_API_KEY and BRAINTRUST_SETUP_PROJECT_ID must both be set together",
    );
  }

  const yolo = readEnvBool(env, "BRAINTRUST_SETUP_YOLO");

  return {
    apiUrl: stripTrailingSlash(parsed["api-url"]),
    appUrl: stripTrailingSlash(parsed["app-url"]),
    apiKey,
    projectId,
    orgId: parsed["org-id"],
    projId: parsed["proj-id"],
    yolo,
  };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
