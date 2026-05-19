export type WizardSessionCreateResponse = {
  readonly session_token: string;
  readonly poll_token: string;
  readonly expires_at: string;
  readonly login_path: string;
};

export type WizardSessionCompleteResult = {
  readonly apiKey: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly projectId: string;
  readonly projectName: string;
};

export type WizardSessionEvents = {
  readonly onLoginUrl: (info: {
    readonly loginUrl: string;
    readonly expiresAt: string;
  }) => void;
  readonly onTryOpenBrowser: (url: string) => Promise<boolean>;
};

const POLL_INTERVAL_MS = 2000;
const SLOW_DOWN_INCREMENT_MS = 1000;
const MAX_POLL_INTERVAL_MS = 30_000;
const POLL_HARD_TIMEOUT_MS = 3 * 60 * 1000;
const CREATE_REQUEST_TIMEOUT_MS = 15_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;

export class WizardSessionAuthClient {
  constructor(private readonly appUrl: string) {}

  async createSession(): Promise<WizardSessionCreateResponse> {
    const res = await fetch(`${this.appUrl}/api/cli/wizard-session/create`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(CREATE_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `Wizard session create failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as WizardSessionCreateResponse;
  }

  buildLoginUrl(session: WizardSessionCreateResponse): string {
    return new URL(session.login_path, this.appUrl).toString();
  }

  async pollSession(args: {
    readonly sessionToken: string;
    readonly pollToken: string;
    readonly sleep?: (ms: number) => Promise<void>;
  }): Promise<WizardSessionCompleteResult> {
    const sleep = args.sleep ?? defaultSleep;
    let interval = POLL_INTERVAL_MS;
    const deadline = Date.now() + POLL_HARD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(interval);
      const url = `${this.appUrl}/api/cli/wizard-session/poll?session_token=${encodeURIComponent(args.sessionToken)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.pollToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429) {
        interval = Math.min(
          interval + SLOW_DOWN_INCREMENT_MS,
          MAX_POLL_INTERVAL_MS,
        );
        res.body?.cancel();
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        throw new Error(
          `Wizard session poll failed: ${res.status} ${JSON.stringify(json)}`,
        );
      }
      const status = json["status"];
      switch (status) {
        case "pending":
          continue;
        case "expired":
          throw new Error("Wizard session expired before approval.");
        case "claimed":
          throw new Error(
            "Wizard session was already claimed by another client.",
          );
        case "complete":
          return parseCompleteResponse(json);
        default:
          throw new Error(
            `Unexpected wizard session status: ${JSON.stringify(json)}`,
          );
      }
    }
    throw new Error("Wizard session timed out.");
  }

  async login(
    events: WizardSessionEvents,
  ): Promise<WizardSessionCompleteResult> {
    const session = await this.createSession();
    const loginUrl = this.buildLoginUrl(session);
    events.onLoginUrl({
      loginUrl,
      expiresAt: session.expires_at,
    });
    await events.onTryOpenBrowser(loginUrl);
    return this.pollSession({
      sessionToken: session.session_token,
      pollToken: session.poll_token,
    });
  }
}

function parseCompleteResponse(
  json: Record<string, unknown>,
): WizardSessionCompleteResult {
  const apiKey = json["api_key"];
  const orgId = json["org_id"];
  const orgName = json["org_name"];
  const projectId = json["project_id"];
  const projectName = json["project_name"];
  if (
    !isNonEmptyString(apiKey) ||
    !isNonEmptyString(orgId) ||
    !isNonEmptyString(orgName) ||
    !isNonEmptyString(projectId) ||
    !isNonEmptyString(projectName)
  ) {
    throw new Error(
      `Wizard session complete response missing required fields: ${JSON.stringify(json)}`,
    );
  }
  return { apiKey, orgId, orgName, projectId, projectName };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
