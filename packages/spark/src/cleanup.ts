/**
 * `appUrl` is the bare host (e.g. https://www.braintrust.dev) — used for auth
 * API calls that live at the root. User-facing app links live under `/app/`
 * per `BRAINTRUST_APP_URL = https://www.braintrust.dev/app` for SaaS.
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
  const base = `${appUrl}/app/${encodeURIComponent(trace.org)}/p/${encodeURIComponent(trace.project)}/logs`;
  const params = new URLSearchParams({ r: trace.rootSpanId });
  if (trace.spanId) {
    params.set("s", trace.spanId);
  }
  return `${base}?${params.toString()}`;
}
