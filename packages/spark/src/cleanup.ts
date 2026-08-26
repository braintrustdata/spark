import { URL } from "node:url";

/**
 * URL formats from /workspace/bt-main/skills/sdk-install/braintrust-url-formats.md.
 * `appUrl` here is the *base* (e.g. https://www.braintrust.dev) — the docs reference
 * `BRAINTRUST_APP_URL` which for the SaaS app is `https://www.braintrust.dev/app`.
 */
export type TraceLocation = {
  readonly org: string;
  readonly project: string;
  readonly rootSpanId: string;
  readonly spanId?: string;
};

export function buildLogsPermalink(
  appUrl: string,
  trace: TraceLocation,
): string {
  const url = new URL(
    `/app/${encodeURIComponent(trace.org)}/p/${encodeURIComponent(trace.project)}/logs`,
    appUrl,
  );
  url.searchParams.set("r", trace.rootSpanId);
  if (trace.spanId) {
    url.searchParams.set("s", trace.spanId);
  }
  return url.href;
}
