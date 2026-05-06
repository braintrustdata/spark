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
  const base = `${appUrl}/${encodeURIComponent(trace.org)}/p/${encodeURIComponent(trace.project)}/logs`;
  const params = new URLSearchParams({ r: trace.rootSpanId });
  if (trace.spanId) {
    params.set("s", trace.spanId);
  }
  return `${base}?${params.toString()}`;
}

export type CleanupContext = {
  readonly docsUrl: string;
  readonly tracePermalink: string | undefined;
};

export function buildCleanupMessage(ctx: CleanupContext): string {
  const lines = [
    "Setup complete.",
    "",
    "For production runs, set the BRAINTRUST_API_KEY environment variable.",
    `Docs: ${ctx.docsUrl}`,
  ];
  if (ctx.tracePermalink) {
    lines.push(`Trace: ${ctx.tracePermalink}`);
  }
  return lines.join("\n");
}
