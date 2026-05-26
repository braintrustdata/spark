import { homedir } from "node:os";
import { basename, isAbsolute, relative } from "node:path";

export function readablePath(
  path: string | undefined,
  cwd: string,
): string | undefined {
  if (!path) return undefined;
  if (!isAbsolute(path)) return path;
  const rel = relative(cwd, path);
  if (rel && !rel.startsWith("..")) return rel;
  const home = homedir();
  if (path.startsWith(home)) return `~/${relative(home, path)}`;
  return basename(path);
}

export function formatToolInput(
  input: Record<string, unknown>,
  cwd: string,
): string | undefined {
  const parts = Object.entries(input)
    .map(([key, value]) => {
      const formatted = formatToolInputValue(key, value, cwd);
      return formatted ? `${key}: ${formatted}` : undefined;
    })
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatToolInputValue(
  key: string,
  value: unknown,
  cwd: string,
): string | undefined {
  if (typeof value === "string") {
    const looksLikePath = key === "path" || key.endsWith("_path");
    return compactSingleLine(
      looksLikePath ? (readablePath(value, cwd) ?? value) : value,
      key === "command" ? 220 : 140,
    );
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const suffix = value.length === 1 ? "item" : "items";
    return `${value.length} ${suffix}`;
  }
  if (value !== null && typeof value === "object") return "object";
  return undefined;
}

export function compactSingleLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return {};
  }
}

export function stringField(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const raw = value[field];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function firstNonEmptyLine(
  ...values: readonly (string | undefined)[]
): string | undefined {
  for (const value of values) {
    const line = value
      ?.split(/\r?\n/)
      .map((part) => part.trim())
      .find(Boolean);
    if (line) return line;
  }
  return undefined;
}
