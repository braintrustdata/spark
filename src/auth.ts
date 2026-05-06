export type DeviceCodeResponse = {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly verification_uri_complete?: string;
  readonly expires_in: number;
  readonly interval: number;
};

export type TokenResponse = {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
};

export type DeviceFlowEvents = {
  readonly onPrompt: (info: {
    readonly userCode: string;
    readonly verificationUri: string;
    readonly verificationUriComplete: string | undefined;
  }) => void;
  readonly onTryOpenBrowser: (url: string) => Promise<boolean>;
};

const DEFAULT_INTERVAL = 5;
const MIN_INTERVAL = 1;

/**
 * RFC 8628 device authorization grant client.
 *
 * Endpoints (added to braintrust monorepo as part of this work):
 *   POST {appUrl}/oauth/device/code  → DeviceCodeResponse
 *   POST {appUrl}/oauth/token         → TokenResponse | { error }
 */
export class DeviceFlowAuthClient {
  constructor(private readonly appUrl: string) {}

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await fetch(`${this.appUrl}/oauth/device/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_id: "bt-wizard", scope: "wizard" }),
    });
    if (!res.ok) {
      throw new Error(
        `Device code request failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as DeviceCodeResponse;
  }

  async pollToken(
    deviceCode: string,
    intervalSec: number,
    expiresInSec: number,
  ): Promise<TokenResponse> {
    let interval = Math.max(intervalSec || DEFAULT_INTERVAL, MIN_INTERVAL);
    const deadline = Date.now() + expiresInSec * 1000;
    while (Date.now() < deadline) {
      await sleep(interval * 1000);
      const res = await fetch(`${this.appUrl}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: "bt-wizard",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (res.ok && typeof json["access_token"] === "string") {
        return json as TokenResponse;
      }
      const error = typeof json["error"] === "string" ? json["error"] : "";
      switch (error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval += 5;
          continue;
        case "access_denied":
          throw new Error("Login was denied.");
        case "expired_token":
          throw new Error("Login expired before approval.");
        default:
          throw new Error(
            `Token poll failed: ${res.status} ${JSON.stringify(json)}`,
          );
      }
    }
    throw new Error("Login expired before approval.");
  }

  async login(events: DeviceFlowEvents): Promise<TokenResponse> {
    const code = await this.requestDeviceCode();
    events.onPrompt({
      userCode: code.user_code,
      verificationUri: code.verification_uri,
      verificationUriComplete: code.verification_uri_complete,
    });
    const browserUrl = code.verification_uri_complete ?? code.verification_uri;
    await events.onTryOpenBrowser(browserUrl);
    return this.pollToken(code.device_code, code.interval, code.expires_in);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
