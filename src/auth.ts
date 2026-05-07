export type WizardSigninCreateResponse = {
  readonly id: string;
  readonly poll_token: string;
  readonly login_path: string;
  readonly login_url: string;
  readonly expires_at: string;
};

export type WizardSigninOrgInfo = {
  readonly id: string;
  readonly name: string;
  readonly api_url?: string | null;
  readonly proxy_url?: string | null;
  readonly realtime_url?: string | null;
  readonly is_universal_api?: boolean | null;
  readonly git_metadata?: unknown;
};

export type WizardSigninProject = {
  readonly id: string;
  readonly name: string;
  readonly org_id: string;
  readonly description?: string | null;
};

export type WizardSigninCompleteResult = {
  readonly apiKey: string;
  readonly orgInfo: WizardSigninOrgInfo;
  readonly project: WizardSigninProject;
};

export type WizardSigninEvents = {
  readonly onLoginUrl: (info: {
    readonly loginUrl: string;
    readonly expiresAt: string;
  }) => void;
  readonly onTryOpenBrowser: (url: string) => Promise<boolean>;
};

const POLL_INTERVAL_MS = 2000;
const SLOW_DOWN_INCREMENT_MS = 1000;
const POLL_HARD_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Browser-mediated wizard sign-in.
 *
 * Endpoints (added by the braintrust-wizard-login-flow PR):
 *   POST {appUrl}/api/cli/wizard-signin/create
 *   GET  {appUrl}/api/cli/wizard-signin/poll?id=...
 *     (Authorization: Bearer <poll_token>)
 *
 * The poll response is one of:
 *   { status: "pending", expires_at }
 *   { status: "expired" }
 *   { status: "claimed" }
 *   { status: "complete", api_key, org_info, project }
 */
export class WizardSigninAuthClient {
  constructor(
    private readonly appUrl: string,
    private readonly clientName: string = "bt-wizard",
  ) {}

  async createSession(): Promise<WizardSigninCreateResponse> {
    const res = await fetch(`${this.appUrl}/api/cli/wizard-signin/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_name: this.clientName }),
    });
    if (!res.ok) {
      throw new Error(
        `Wizard sign-in create failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as WizardSigninCreateResponse;
  }

  async pollSession(args: {
    readonly id: string;
    readonly pollToken: string;
    readonly sleep?: (ms: number) => Promise<void>;
  }): Promise<WizardSigninCompleteResult> {
    const sleep = args.sleep ?? defaultSleep;
    let interval = POLL_INTERVAL_MS;
    const deadline = Date.now() + POLL_HARD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(interval);
      const url = `${this.appUrl}/api/cli/wizard-signin/poll?id=${encodeURIComponent(args.id)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.pollToken}`,
          Accept: "application/json",
        },
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (res.status === 429) {
        interval += SLOW_DOWN_INCREMENT_MS;
        continue;
      }
      if (!res.ok) {
        throw new Error(
          `Wizard sign-in poll failed: ${res.status} ${JSON.stringify(json)}`,
        );
      }
      const status = json["status"];
      switch (status) {
        case "pending":
          continue;
        case "expired":
          throw new Error("Wizard sign-in session expired before approval.");
        case "claimed":
          throw new Error(
            "Wizard sign-in session was already claimed by another client.",
          );
        case "complete":
          return parseCompleteResponse(json);
        default:
          throw new Error(
            `Unexpected wizard sign-in status: ${JSON.stringify(json)}`,
          );
      }
    }
    throw new Error("Wizard sign-in session timed out.");
  }

  async login(events: WizardSigninEvents): Promise<WizardSigninCompleteResult> {
    const session = await this.createSession();
    events.onLoginUrl({
      loginUrl: session.login_url,
      expiresAt: session.expires_at,
    });
    await events.onTryOpenBrowser(session.login_url);
    return this.pollSession({
      id: session.id,
      pollToken: session.poll_token,
    });
  }
}

function parseCompleteResponse(
  json: Record<string, unknown>,
): WizardSigninCompleteResult {
  const apiKey = json["api_key"];
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("Wizard sign-in completed without an api_key");
  }
  const orgInfo = parseOrgInfo(json["org_info"]);
  const project = parseProject(json["project"]);
  return { apiKey, orgInfo, project };
}

function parseOrgInfo(value: unknown): WizardSigninOrgInfo {
  if (!isObject(value)) {
    throw new Error("Wizard sign-in completed without org_info");
  }
  const id = value["id"];
  const name = value["name"];
  if (typeof id !== "string" || typeof name !== "string") {
    throw new Error("Wizard sign-in org_info missing id/name");
  }
  return {
    id,
    name,
    api_url: optionalString(value["api_url"]),
    proxy_url: optionalString(value["proxy_url"]),
    realtime_url: optionalString(value["realtime_url"]),
    is_universal_api:
      typeof value["is_universal_api"] === "boolean"
        ? value["is_universal_api"]
        : null,
    git_metadata: value["git_metadata"],
  };
}

function parseProject(value: unknown): WizardSigninProject {
  if (!isObject(value)) {
    throw new Error("Wizard sign-in completed without project");
  }
  const id = value["id"];
  const name = value["name"];
  const orgId = value["org_id"];
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof orgId !== "string"
  ) {
    throw new Error("Wizard sign-in project missing id/name/org_id");
  }
  return {
    id,
    name,
    org_id: orgId,
    description: optionalString(value["description"]),
  };
}

function optionalString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
