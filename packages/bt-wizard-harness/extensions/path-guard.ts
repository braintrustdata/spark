/**
 * Path-guard extension.
 *
 * Restricts file-touching tool calls (read/write/edit/grep/find/ls) to:
 *   - the harness's working directory and its subtree, AND
 *   - `<git-root>/.env.braintrust` exactly, AND
 *   - the path in `BT_WIZARD_RESULT_FILE` (used by the wizard to receive the
 *     trace permalink), if set.
 *
 * Anything outside that scope is blocked with a clear reason. This is the
 * file-system half of the bt-wizard tool whitelist; bash/python are removed
 * by running pi with --no-builtin-tools and an explicit -t allowlist.
 */

import { spawnSync } from "node:child_process";
import { resolve, isAbsolute, basename } from "node:path";
import { existsSync } from "node:fs";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function gitRoot(cwd: string): string | undefined {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return undefined;
  }
  const out = r.stdout.trim();
  return out.length > 0 ? out : undefined;
}

function isUnderRoot(absPath: string, root: string): boolean {
  const rel = absPath.startsWith(root + "/") || absPath === root;
  return rel;
}

const PATH_FIELDS = [
  "path",
  "file_path",
  "filename",
  "directory",
  "dir",
] as const;

function extractPath(input: Record<string, unknown>): string | undefined {
  for (const f of PATH_FIELDS) {
    const v = input[f];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

// Tools that can mutate the filesystem — strictly scoped to cwd.
const WRITE_TOOLS = new Set(["write", "edit"]);
// Read-only tools — also allowed to access pi's data dir (skills, extensions).
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

export default function pathGuard(pi: ExtensionAPI) {
  const cwd = process.cwd();
  const cwdAbs = resolve(cwd);
  const root = gitRoot(cwdAbs);
  const envBraintrust = root ? resolve(root, ".env.braintrust") : undefined;
  const resultFileRaw = process.env["BT_WIZARD_RESULT_FILE"];
  const resultFile =
    resultFileRaw && resultFileRaw.length > 0
      ? resolve(resultFileRaw)
      : undefined;

  const exceptions = [envBraintrust, resultFile].filter(
    (p): p is string => typeof p === "string",
  );
  // pi stores skills, extensions, and config under ~/.agents/
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const piDataDir = homeDir ? resolve(homeDir, ".agents") : undefined;

  pi.on("tool_call", async (event) => {
    const isWrite = WRITE_TOOLS.has(event.toolName);
    const isRead = READ_TOOLS.has(event.toolName);
    if (!isWrite && !isRead) {
      return undefined;
    }
    const raw = extractPath(event.input as Record<string, unknown>);
    if (!raw) {
      return undefined;
    }
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(cwdAbs, raw);

    if (basename(abs) === ".env") {
      return {
        block: true,
        reason: `Accessing "${raw}" is not allowed; use .env.braintrust instead.`,
      };
    }
    if (exceptions.includes(abs)) {
      return undefined;
    }
    if (isUnderRoot(abs, cwdAbs)) {
      return undefined;
    }
    // Allow read-only tools to access pi's data directory (skills, extensions).
    if (isRead && piDataDir && isUnderRoot(abs, piDataDir)) {
      return undefined;
    }
    return {
      block: true,
      reason: `Path "${raw}" is outside the bt-wizard scope (cwd subtree${
        exceptions.length > 0 ? ` plus ${exceptions.join(", ")}` : ""
      }).`,
    };
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }
    ctx.ui.setToolsExpanded(false);
    ctx.ui.notify(
      `bt-wizard path-guard active: cwd=${cwdAbs}${
        exceptions.length > 0 ? `, exception=${exceptions.join(", ")}` : ""
      }${existsSync(cwdAbs) ? "" : " (cwd missing!)"}`,
      "info",
    );
  });
}
