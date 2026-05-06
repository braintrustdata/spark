/**
 * `curl` extension.
 *
 * Read-only HTTP fetcher. GET and HEAD are permitted; POST/PUT/DELETE and
 * other stateful methods are blocked. Redirects are followed. Used by the
 * agent to read external documentation (e.g. https://www.braintrust.dev/docs,
 * library README pages, package indexes).
 *
 * No URL allow/block list — the agent may need to consult arbitrary
 * library docs. Path-guard still constrains the file system.
 */

import { Type } from "typebox";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CURL_PARAMS = Type.Object({
  url: Type.String({ description: "Absolute http(s) URL." }),
  method: Type.Optional(
    Type.Union([Type.Literal("GET"), Type.Literal("HEAD")], {
      description:
        "HTTP method. Defaults to GET. Only GET and HEAD are allowed.",
    }),
  ),
  headers: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Extra request headers (e.g. Accept).",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({
      description: "Hard timeout in milliseconds (default 30000).",
      minimum: 1000,
      maximum: 300000,
    }),
  ),
});

type CurlParams = {
  url: string;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeout_ms?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1_000_000;

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function runCurl(params: CurlParams): Promise<{
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}> {
  const method = params.method ?? "GET";
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Method ${method} is not permitted (GET/HEAD only).`);
  }
  if (!isHttpUrl(params.url)) {
    throw new Error(`URL must be http(s): ${params.url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    params.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const res = await fetch(params.url, {
      method,
      headers: params.headers,
      redirect: "follow",
      signal: controller.signal,
    });

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });

    let body = "";
    let truncated = false;
    if (method !== "HEAD") {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder("utf-8", { fatal: false });
        let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (bytes + value.byteLength > MAX_BODY_BYTES) {
            body += decoder.decode(value.subarray(0, MAX_BODY_BYTES - bytes), {
              stream: false,
            });
            truncated = true;
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            break;
          }
          bytes += value.byteLength;
          body += decoder.decode(value, { stream: true });
        }
        if (!truncated) {
          body += decoder.decode();
        }
      }
    }

    return {
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      headers,
      body,
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

export default function curlTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "curl",
    label: "curl (GET/HEAD)",
    description:
      "Fetch a URL via HTTP GET or HEAD. Follows redirects. No POST/PUT/DELETE. Use to read docs, READMEs, package indexes.",
    promptSnippet:
      "Use `curl` to fetch documentation pages or other read-only HTTP resources. POST and stateful methods are not available — anything stateful must go through `bt`.",
    promptGuidelines: [
      "Only GET and HEAD are permitted; the tool errors otherwise.",
      "Pass full absolute URLs.",
      "Prefer https://www.braintrust.dev/docs/... for Braintrust-specific guidance.",
      "Bodies above 1 MB are truncated; the response indicates truncation.",
    ],
    parameters: CURL_PARAMS,
    async execute(_toolCallId, params) {
      try {
        const result = await runCurl(params as CurlParams);
        const headerLines = Object.entries(result.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        const truncatedNote = result.truncated
          ? "\n[body truncated to 1 MB]"
          : "";
        const text = [
          `${result.status} ${result.statusText} (${result.url})`,
          "--- headers ---",
          headerLines,
          "--- body ---",
          result.body + truncatedNote,
        ].join("\n");
        return {
          content: [{ type: "text", text }],
          details: {
            status: result.status,
            url: result.url,
            truncated: result.truncated,
          },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `curl failed: ${(err as Error).message}`,
            },
          ],
          details: { error: (err as Error).message },
        };
      }
    },
  });
}
