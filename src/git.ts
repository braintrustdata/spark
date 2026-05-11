import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

export async function findGitRoot(
  startDir: string,
): Promise<string | undefined> {
  let dir = resolve(startDir);
  while (true) {
    if (await pathExists(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await findGitRoot(cwd)) !== undefined;
}

const ENV_FILENAME = ".env.braintrust";

export type EnvFileWriteResult = {
  readonly envFilePath: string;
  readonly gitignorePath: string | undefined;
  readonly addedToGitignore: boolean;
  readonly alreadyCovered: boolean;
};

export async function writeEnvBraintrust(
  gitRoot: string,
  apiKey: string,
): Promise<EnvFileWriteResult> {
  const envFilePath = join(gitRoot, ENV_FILENAME);
  await writeFile(envFilePath, `BRAINTRUST_API_KEY=${apiKey}\n`, {
    mode: 0o600,
  });

  const gitignorePath = join(gitRoot, ".gitignore");
  const existing = (await pathExists(gitignorePath))
    ? await readFile(gitignorePath, "utf8")
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
  await writeFile(gitignorePath, `${existing}${sep}${ENV_FILENAME}\n`);
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
