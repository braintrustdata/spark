export type WizardSessionCreateResponse = {
  readonly session_token: string;
  readonly poll_token: string;
  readonly expires_at: string;
  readonly login_path: string;
  readonly verification_code: string;
};

export type WizardSessionCompleteResult = {
  readonly apiKey: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly projectId: string;
  readonly projectName: string;
};

type WizardSessionCompleteResponse = {
  readonly api_key: string;
  readonly org_id: string;
  readonly org_name: string;
  readonly project_id: string;
  readonly project_name: string;
};

export type WizardSessionEvents = {
  readonly onLoginUrl: (info: {
    readonly loginUrl: string;
    readonly expiresAt: string;
    readonly verificationCode: string;
  }) => void;
  readonly onTryOpenBrowser: (url: string) => Promise<boolean>;
};

export type WizardSessionAuthMode = "signin" | "signup";

export type WizardSessionLoginUrlParams = {
  readonly orgId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly authMode?: WizardSessionAuthMode | undefined;
};

export type WizardSessionLoginArgs = {
  readonly events: WizardSessionEvents;
  readonly loginUrlParams?: WizardSessionLoginUrlParams;
};

const POLL_INTERVAL_MS = 2000;
const SLOW_DOWN_INCREMENT_MS = 1000;
const MAX_POLL_INTERVAL_MS = 30_000;
const POLL_HARD_TIMEOUT_MS = 3 * 60 * 1000;
const CREATE_REQUEST_TIMEOUT_MS = 15_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const LOGIN_ORG_ID_PARAM = "org_id";
const LOGIN_PROJECT_ID_PARAM = "project_id";
const LOGIN_AUTH_PARAM = "auth";

export type WizardSessionLogin = (
  args: WizardSessionLoginArgs,
) => Promise<WizardSessionCompleteResult>;

export async function createWizardSession(
  appUrl: string,
): Promise<WizardSessionCreateResponse> {
  const res = await fetch(`${appUrl}/api/cli/wizard-session/create`, {
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

export function buildWizardSessionLoginUrl(
  appUrl: string,
  session: WizardSessionCreateResponse,
  params?: WizardSessionLoginUrlParams,
): string {
  const url = new URL(session.login_path, appUrl);
  if (params?.orgId) {
    url.searchParams.set(LOGIN_ORG_ID_PARAM, params.orgId);
  }
  if (params?.projectId) {
    url.searchParams.set(LOGIN_PROJECT_ID_PARAM, params.projectId);
  }
  if (params?.authMode) {
    url.searchParams.set(LOGIN_AUTH_PARAM, params.authMode);
  }
  return url.toString();
}

export async function pollWizardSession(args: {
  readonly appUrl: string;
  readonly sessionToken: string;
  readonly pollToken: string;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<WizardSessionCompleteResult> {
  const sleep = args.sleep ?? defaultSleep;
  let interval = POLL_INTERVAL_MS;
  const deadline = Date.now() + POLL_HARD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(interval);
    const url = `${args.appUrl}/api/cli/wizard-session/poll?session_token=${encodeURIComponent(args.sessionToken)}`;
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
      void res.body?.cancel();
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
      case "complete": {
        const complete = json as WizardSessionCompleteResponse;
        return {
          apiKey: complete.api_key,
          orgId: complete.org_id,
          orgName: complete.org_name,
          projectId: complete.project_id,
          projectName: complete.project_name,
        };
      }
      default:
        throw new Error(
          `Unexpected wizard session status: ${JSON.stringify(json)}`,
        );
    }
  }
  throw new Error("Wizard session timed out.");
}

export async function loginWithWizardSession(args: {
  readonly appUrl: string;
  readonly loginUrlParams?: WizardSessionLoginUrlParams;
  readonly events: WizardSessionEvents;
}): Promise<WizardSessionCompleteResult> {
  const session = await createWizardSession(args.appUrl);
  const loginUrl = buildWizardSessionLoginUrl(
    args.appUrl,
    session,
    args.loginUrlParams,
  );
  args.events.onLoginUrl({
    loginUrl,
    expiresAt: session.expires_at,
    verificationCode: session.verification_code,
  });
  await args.events.onTryOpenBrowser(loginUrl);
  return pollWizardSession({
    appUrl: args.appUrl,
    sessionToken: session.session_token,
    pollToken: session.poll_token,
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
