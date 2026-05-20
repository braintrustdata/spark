export type Org = {
  readonly id: string;
  readonly name: string;
  readonly api_url?: string | null;
  readonly proxy_url?: string | null;
};

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly org_id: string;
};

export type ApiKey = {
  readonly id: string;
  readonly name: string;
  readonly preview_name?: string;
};

export type ApiKeyWithSecret = ApiKey & {
  readonly key: string;
};

export type CurrentUser = {
  readonly id: string;
  readonly given_name?: string | null;
  readonly family_name?: string | null;
  readonly email?: string | null;
};

export type DataPlane = "us" | "eu";

const DATA_PLANE_API_URLS: Record<DataPlane, string> = {
  us: "https://api.braintrust.dev",
  eu: "https://api.eu.braintrust.dev",
};

export function dataPlaneApiUrl(plane: DataPlane): string {
  return DATA_PLANE_API_URLS[plane];
}

export class BraintrustApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: T; headers: Headers }> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BraintrustApiError(res.status, method, path, text);
    }
    const data = (await res.json()) as T;
    return { data, headers: res.headers };
  }

  async listOrgs(): Promise<readonly Org[]> {
    const { data } = await this.request<{ objects: Org[] }>(
      "GET",
      "/v1/organization?limit=200",
    );
    return data.objects;
  }

  async createOrg(args: {
    readonly orgName: string;
    readonly dataPlane: DataPlane;
  }): Promise<{ readonly id: string; readonly existed: boolean }> {
    const apiUrl = dataPlaneApiUrl(args.dataPlane);
    const { data, headers } = await this.request<string>(
      "POST",
      "/v1/organization",
      { org_name: args.orgName, api_url: apiUrl },
    );
    const id = typeof data === "string" ? data : (data as { id: string }).id;
    return { id, existed: headers.get("x-bt-found-existing") === "true" };
  }

  async getProject(id: string): Promise<Project> {
    const { data } = await this.request<Project>(
      "GET",
      `/v1/project/${encodeURIComponent(id)}`,
    );
    return data;
  }

  async getOrg(id: string): Promise<Org> {
    const { data } = await this.request<Org>(
      "GET",
      `/v1/organization/${encodeURIComponent(id)}`,
    );
    return data;
  }

  async listProjects(orgId: string): Promise<readonly Project[]> {
    const { data } = await this.request<{ objects: Project[] }>(
      "GET",
      `/v1/project?org_id=${encodeURIComponent(orgId)}&limit=500`,
    );
    return data.objects;
  }

  async createProject(args: {
    readonly orgId: string;
    readonly name: string;
  }): Promise<Project> {
    const { data } = await this.request<Project>("POST", "/v1/project", {
      org_id: args.orgId,
      name: args.name,
    });
    return data;
  }

  async listApiKeyNames(orgId: string): Promise<readonly string[]> {
    const { data } = await this.request<{ objects: ApiKey[] }>(
      "GET",
      `/v1/api_key?org_id=${encodeURIComponent(orgId)}&limit=500`,
    );
    return data.objects.map((k) => k.name);
  }

  async createApiKey(args: {
    readonly orgId: string;
    readonly name: string;
  }): Promise<ApiKeyWithSecret> {
    const { data } = await this.request<ApiKeyWithSecret>(
      "POST",
      "/v1/api_key",
      { org_id: args.orgId, name: args.name },
    );
    return data;
  }

  async currentUser(): Promise<CurrentUser> {
    const { data } = await this.request<CurrentUser>("GET", "/v1/user/me");
    return data;
  }

  /**
   * Like {@link currentUser}, but retries on 401 to ride out the brief
   * Clerk-webhook race where a freshly-signed-up user's `bt_auth_id` hasn't
   * landed in `publicMetadata` yet. See app/api/actions/util.ts:62 in the
   * braintrust monorepo for the same race.
   *
   * Only 401s are retried; other failures throw immediately.
   */
  async currentUserAwaitingProvisioning(args?: {
    readonly delaysMs?: readonly number[];
    readonly sleep?: (ms: number) => Promise<void>;
  }): Promise<CurrentUser> {
    const delays = args?.delaysMs ?? PROVISIONING_RETRY_DELAYS_MS;
    const sleep = args?.sleep ?? defaultSleep;
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        return await this.currentUser();
      } catch (e) {
        lastError = e;
        if (!(e instanceof BraintrustApiError) || e.status !== 401) {
          throw e;
        }
        if (attempt === delays.length) {
          throw new Error(
            "Your Braintrust account is still being provisioned. Please try `spark` again in a moment.",
            { cause: e },
          );
        }
        await sleep(delays[attempt]!);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("currentUserAwaitingProvisioning: unreachable");
  }
}

const PROVISIONING_RETRY_DELAYS_MS: readonly number[] = [
  1000, 1500, 2000, 3000, 4000,
];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class BraintrustApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(`${method} ${path} → ${status}: ${responseBody.slice(0, 200)}`);
    this.name = "BraintrustApiError";
  }
}

export function buildApiKeyName(args: {
  readonly userHandle: string;
  readonly existingNames: readonly string[];
}): string {
  const base = `${args.userHandle}-created-by-spark`;
  for (let n = 0; n < 10000; n += 1) {
    const candidate = `${base}${n}`;
    if (!args.existingNames.includes(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not find a unique API key name");
}

export function userHandle(user: CurrentUser): string {
  if (user.email && user.email.length > 0) {
    return user.email.split("@")[0]?.toLowerCase() ?? user.id;
  }
  if (user.given_name) {
    return user.given_name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }
  return user.id;
}
