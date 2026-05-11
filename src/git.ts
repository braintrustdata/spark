import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findGitRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export function isGitRepo(cwd: string): boolean {
  return findGitRoot(cwd) !== undefined;
}

const ENV_FILENAME = ".env.braintrust";

export type EnvFileWriteResult = {
  readonly envFilePath: string;
  readonly gitignorePath: string | undefined;
  readonly addedToGitignore: boolean;
  readonly alreadyCovered: boolean;
};

export function writeEnvBraintrust(
  gitRoot: string,
  apiKey: string,
): EnvFileWriteResult {
  const envFilePath = join(gitRoot, ENV_FILENAME);
  writeFileSync(envFilePath, `BRAINTRUST_API_KEY=${apiKey}\n`, { mode: 0o600 });

  const gitignorePath = join(gitRoot, ".gitignore");
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf8")
    : "";

  const alreadyCovered = gitignoreCovers(existing, ENV_FILENAME);
  if (alreadyCovered) {
    return {
      envFilePath,
      gitignorePath,
      addedToGitignore: false,
      alreadyCovered: true,
    };
  }

  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, `${existing}${sep}${ENV_FILENAME}\n`);
  return {
    envFilePath,
    gitignorePath,
    addedToGitignore: true,
    alreadyCovered: false,
  };
}

export function gitignoreCovers(content: string, filename: string): boolean {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    if (matchesGitignorePattern(line, filename)) {
      return true;
    }
  }
  return false;
}

function matchesGitignorePattern(pattern: string, filename: string): boolean {
  let p = pattern;
  if (p.startsWith("/")) {
    p = p.slice(1);
  }
  if (p.endsWith("/")) {
    return false;
  }
  const regexSrc = `^${p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")}$`;
  return new RegExp(regexSrc).test(filename);
}
