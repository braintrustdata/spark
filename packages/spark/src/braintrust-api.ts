import { URL } from "node:url";

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

export class BraintrustApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(path, this.apiUrl);
    const res = await fetch(url.href, {
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
    return (await res.json()) as T;
  }

  async getProject(id: string): Promise<Project> {
    return this.request<Project>(
      "GET",
      `/v1/project/${encodeURIComponent(id)}`,
    );
  }

  async getOrg(id: string): Promise<Org> {
    return this.request<Org>(
      "GET",
      `/v1/organization/${encodeURIComponent(id)}`,
    );
  }
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
