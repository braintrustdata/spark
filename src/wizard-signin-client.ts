import { setTimeout as sleep } from "node:timers/promises";

import { type QueryClient } from "@tanstack/react-query";

import { createQueryClient } from "./query-client";

export const WIZARD_BACKEND_URL_ENV = "BRAINTRUST_WIZARD_BACKEND_URL";
export const DEFAULT_WIZARD_BACKEND_URL = "https://www.braintrust.dev";
export const DEFAULT_WIZARD_SIGNIN_POLL_INTERVAL_MS = 2_000;
export const WIZARD_SIGNIN_AUTH_QUERY_PARAM = "auth";

const CLIENT_NAME = "braintrust-wizard";

let requestCounter = 0;

export type WizardSigninAuthMode = "signin" | "signup";

export type WizardSigninSession = {
  readonly id: string;
  readonly pollToken: string;
  readonly loginPath: string;
  readonly loginUrl: string;
  readonly expiresAt: string;
};

export type WizardSigninOrgInfo = Record<string, unknown> & {
  readonly id: string;
  readonly name: string;
};

export type WizardSigninProject = Record<string, unknown> & {
  readonly id: string;
  readonly name: string;
};

export type WizardSigninPollResult =
  | { readonly status: "pending"; readonly expiresAt: string }
  | { readonly status: "expired" }
  | { readonly status: "claimed" }
  | {
      readonly status: "complete";
      readonly apiKey: string;
      readonly orgInfo: WizardSigninOrgInfo;
      readonly project: WizardSigninProject;
    };

export type CompletedWizardSigninResult = Extract<
  WizardSigninPollResult,
  { readonly status: "complete" }
>;

export type WizardSigninClient = {
  readonly backendUrl: string;
  readonly createSigninSession: () => Promise<WizardSigninSession>;
  readonly pollSigninSession: (
    session: WizardSigninSession,
  ) => Promise<WizardSigninPollResult>;
};

export type WizardSigninClientOptions = {
  readonly backendUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly queryClient?: QueryClient;
};

export class WizardSigninRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WizardSigninRequestError";
  }
}

export class WizardSigninTerminalStatusError extends Error {
  constructor(readonly status: "expired" | "claimed") {
    super(terminalStatusMessage(status));
    this.name = "WizardSigninTerminalStatusError";
  }
}

export function getWizardBackendUrl(env: NodeJS.ProcessEnv = process.env) {
  return normalizeWizardBackendUrl(
    env[WIZARD_BACKEND_URL_ENV] || DEFAULT_WIZARD_BACKEND_URL,
  );
}

export function createWizardSigninClient(
  options: WizardSigninClientOptions = {},
): WizardSigninClient {
  const backendUrl = normalizeWizardBackendUrl(
    options.backendUrl ?? getWizardBackendUrl(options.env),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const queryClient = options.queryClient ?? createQueryClient();

  return {
    backendUrl,
    async createSigninSession() {
      return await queryClient.fetchQuery({
        queryKey: nextQueryKey("create", backendUrl),
        queryFn: async () =>
          await createSigninSession({ backendUrl, fetchImpl }),
      });
    },
    async pollSigninSession(session) {
      return await queryClient.fetchQuery({
        queryKey: nextQueryKey("poll", backendUrl, session.id),
        queryFn: async () =>
          await pollSigninSession({ backendUrl, fetchImpl, session }),
      });
    },
  };
}

export async function waitForWizardSigninCompletion({
  client,
  session,
  pollIntervalMs = DEFAULT_WIZARD_SIGNIN_POLL_INTERVAL_MS,
  onPollResult,
}: {
  readonly client: WizardSigninClient;
  readonly session: WizardSigninSession;
  readonly pollIntervalMs?: number;
  readonly onPollResult?: (result: WizardSigninPollResult) => void;
}): Promise<CompletedWizardSigninResult> {
  for (;;) {
    const result = await client.pollSigninSession(session);
    onPollResult?.(result);

    switch (result.status) {
      case "complete":
        return result;
      case "expired":
      case "claimed":
        throw new WizardSigninTerminalStatusError(result.status);
      case "pending":
        await sleep(pollIntervalMs);
        break;
    }
  }
}

export function loginUrlWithAuthMode(
  loginUrl: string,
  authMode: WizardSigninAuthMode,
) {
  const url = new URL(loginUrl);
  url.searchParams.set(WIZARD_SIGNIN_AUTH_QUERY_PARAM, authMode);
  return url.toString();
}

function normalizeWizardBackendUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      `${WIZARD_BACKEND_URL_ENV} must be an absolute URL, received ${JSON.stringify(
        rawUrl,
      )}.`,
    );
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function nextQueryKey(...parts: readonly string[]) {
  requestCounter += 1;
  return ["wizard-signin", ...parts, String(requestCounter)] as const;
}

async function createSigninSession({
  backendUrl,
  fetchImpl,
}: {
  readonly backendUrl: string;
  readonly fetchImpl: typeof fetch;
}) {
  const json = await fetchJson({
    fetchImpl,
    url: endpointUrl(backendUrl, "/api/cli/wizard-signin/create"),
    description: "Creating wizard sign-in session",
    init: {
      body: JSON.stringify({ client_name: CLIENT_NAME }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  });

  return parseCreateResponse(json);
}

async function pollSigninSession({
  backendUrl,
  fetchImpl,
  session,
}: {
  readonly backendUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly session: WizardSigninSession;
}) {
  const url = new URL(endpointUrl(backendUrl, "/api/cli/wizard-signin/poll"));
  url.searchParams.set("id", session.id);

  const json = await fetchJson({
    fetchImpl,
    url: url.toString(),
    description: "Polling wizard sign-in session",
    init: {
      headers: {
        Authorization: `Bearer ${session.pollToken}`,
      },
      method: "GET",
    },
  });

  return parsePollResponse(json);
}

async function fetchJson({
  fetchImpl,
  url,
  description,
  init,
}: {
  readonly fetchImpl: typeof fetch;
  readonly url: string;
  readonly description: string;
  readonly init: RequestInit;
}) {
  const response = await fetchImpl(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new WizardSigninRequestError(
      `${description} failed with ${response.status}: ${readErrorText(
        text,
        response.statusText,
      )}`,
      response.status,
    );
  }

  if (!text.trim()) {
    throw new Error(`${description} returned an empty response.`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${description} returned invalid JSON.`);
  }
}

function endpointUrl(backendUrl: string, path: string) {
  return `${backendUrl}${path}`;
}

function parseCreateResponse(value: unknown): WizardSigninSession {
  const record = requireRecord(value, "create response");
  const loginUrl = requireString(record, "login_url", "create response");
  validateAbsoluteUrl(loginUrl, "create response login_url");

  return {
    id: requireString(record, "id", "create response"),
    pollToken: requireString(record, "poll_token", "create response"),
    loginPath: requireString(record, "login_path", "create response"),
    loginUrl,
    expiresAt: requireString(record, "expires_at", "create response"),
  };
}

function parsePollResponse(value: unknown): WizardSigninPollResult {
  const record = requireRecord(value, "poll response");
  const status = requireString(record, "status", "poll response");

  switch (status) {
    case "pending":
      return {
        status,
        expiresAt: requireString(record, "expires_at", "poll response"),
      };
    case "expired":
    case "claimed":
      return { status };
    case "complete":
      return {
        status,
        apiKey: requireString(record, "api_key", "poll response"),
        orgInfo: parseOrgInfo(record.org_info),
        project: parseProject(record.project),
      };
    default:
      throw new Error(
        `Unexpected wizard sign-in status ${JSON.stringify(status)}.`,
      );
  }
}

function parseOrgInfo(value: unknown): WizardSigninOrgInfo {
  const record = requireRecord(value, "poll response org_info");
  return {
    ...record,
    id: requireString(record, "id", "poll response org_info"),
    name: requireString(record, "name", "poll response org_info"),
  };
}

function parseProject(value: unknown): WizardSigninProject {
  const record = requireRecord(value, "poll response project");
  return {
    ...record,
    id: requireString(record, "id", "poll response project"),
    name: requireString(record, "name", "poll response project"),
  };
}

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${context} to be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  context: string,
) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${context}.${key} to be a non-empty string.`);
  }

  return value;
}

function validateAbsoluteUrl(value: string, context: string) {
  try {
    new URL(value);
  } catch {
    throw new Error(`Expected ${context} to be an absolute URL.`);
  }
}

function readErrorText(text: string, fallback: string) {
  if (!text.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const record = requireRecord(parsed, "error response");
    const message = record.error;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  } catch {
    return text;
  }

  return text;
}

function terminalStatusMessage(status: "expired" | "claimed") {
  if (status === "expired") {
    return "The Braintrust wizard sign-in session expired. Start the wizard again.";
  }

  return "The Braintrust wizard sign-in session was already claimed. Start the wizard again.";
}
