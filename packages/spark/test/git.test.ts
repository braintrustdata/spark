import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findGitRoot, isGitRepo } from "../src/git";

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
});
