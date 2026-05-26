import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function allocateResultFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "braintrust-setup-"));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "result.txt");
  writeFileSync(path, "");
  return path;
}

export function readResultFile(path: string): string | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}
