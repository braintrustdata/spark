import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type DetectedLanguage =
  | "python"
  | "typescript"
  | "go"
  | "java"
  | "ruby"
  | "csharp";

const FILENAME_INDICATORS: ReadonlyArray<readonly [string, DetectedLanguage]> =
  [
    ["pyproject.toml", "python"],
    ["setup.py", "python"],
    ["requirements.txt", "python"],
    ["package.json", "typescript"],
    ["tsconfig.json", "typescript"],
    ["go.mod", "go"],
    ["pom.xml", "java"],
    ["build.gradle", "java"],
    ["build.gradle.kts", "java"],
    ["Gemfile", "ruby"],
  ];

const EXTENSION_INDICATORS: ReadonlyArray<readonly [string, DetectedLanguage]> =
  [
    [".csproj", "csharp"],
    [".sln", "csharp"],
    [".gemspec", "ruby"],
  ];

/**
 * Detect candidate languages by scanning the directory; mirrors bt-main's
 * detect_languages_from_dir. Scans cwd first; recurses into immediate
 * subdirectories only if nothing matched at the top level.
 */
export function detectLanguages(dir: string): readonly DetectedLanguage[] {
  const found = new Set<DetectedLanguage>();
  scan(dir, found);
  if (found.size === 0) {
    if (!existsSync(dir)) {
      return [];
    }
    for (const entry of readdirSync(dir)) {
      const child = join(dir, entry);
      let isDir: boolean;
      try {
        isDir = statSync(child).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        scan(child, found);
      }
    }
  }
  return [...found].sort();
}

function scan(dir: string, found: Set<DetectedLanguage>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    let isFile: boolean;
    try {
      isFile = statSync(path).isFile();
    } catch {
      continue;
    }
    if (!isFile) {
      continue;
    }
    const lower = name.toLowerCase();
    for (const [indicator, lang] of FILENAME_INDICATORS) {
      if (lower === indicator.toLowerCase()) {
        found.add(lang);
      }
    }
    for (const [ext, lang] of EXTENSION_INDICATORS) {
      if (lower.endsWith(ext.toLowerCase())) {
        found.add(lang);
      }
    }
  }
}
