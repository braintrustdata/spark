export type WizardOptions = {
  readonly apiUrl: string;
  readonly appUrl: string;
  readonly caCertPath: string | undefined;
};

export type ParsedArgs = {
  readonly options: WizardOptions;
  readonly help: boolean;
};

const DEFAULT_API_URL = "https://api.braintrust.dev";
const DEFAULT_APP_URL = "https://www.braintrust.dev";

const HELP = `Usage: bt-wizard [options]

Options:
  --api-url <URL>            Override API URL [env: BRAINTRUST_API_URL]
  --app-url <URL>            Override app URL [env: BRAINTRUST_APP_URL]
  --ca-cert <PATH>           Path to PEM CA bundle [env: BRAINTRUST_CA_CERT; overrides SSL_CERT_FILE]
  -h, --help                 Show help
`;

export function helpText(): string {
  return HELP;
}

export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): ParsedArgs {
  let apiUrl = env["BRAINTRUST_API_URL"] ?? DEFAULT_API_URL;
  let appUrl = env["BRAINTRUST_APP_URL"] ?? DEFAULT_APP_URL;
  let caCertPath = env["BRAINTRUST_CA_CERT"] ?? env["SSL_CERT_FILE"];
  let help = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return v;
    };
    switch (arg) {
      case "--api-url":
        apiUrl = next();
        break;
      case "--app-url":
        appUrl = next();
        break;
      case "--ca-cert":
        caCertPath = next();
        break;
      case "-h":
      case "--help":
        help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
    i += 1;
  }

  return {
    help,
    options: {
      apiUrl: stripTrailingSlash(apiUrl),
      appUrl: stripTrailingSlash(appUrl),
      caCertPath: caCertPath || undefined,
    },
  };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
