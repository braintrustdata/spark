import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findGitRoot,
  getUncommittedOrUntrackedFiles,
  isGitRepo,
} from "../src/git";

describe("git repository detection", () => {
  it("detects git worktrees from nested directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "braintrust-setup-git-"));
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const child = join(root, "app", "src");
    mkdirSync(child, { recursive: true });

    await expect(isGitRepo(child)).resolves.toBe(true);
    await expect(findGitRoot(child)).resolves.toBe(realpathSync(root));
  });

  it("returns false outside git worktrees", async () => {
    const root = mkdtempSync(join(tmpdir(), "braintrust-setup-nogit-"));

    await expect(isGitRepo(root)).resolves.toBe(false);
    await expect(findGitRoot(root)).resolves.toBeUndefined();
  });

  it("lists uncommitted and untracked files", async () => {
    const root = mkdtempSync(join(tmpdir(), "braintrust-setup-git-"));
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(join(root, "tracked.ts"), "initial\n");
    execFileSync("git", ["add", "tracked.ts"], { cwd: root });
    writeFileSync(join(root, "tracked.ts"), "changed\n");
    writeFileSync(join(root, "untracked.ts"), "new\n");

    await expect(getUncommittedOrUntrackedFiles(root)).resolves.toEqual(
      expect.arrayContaining(["tracked.ts", "untracked.ts"]),
    );
  });
});
