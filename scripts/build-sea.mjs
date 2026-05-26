#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { platform } from "node:os";

const isWindows = platform() === "win32";
const isMac = platform() === "darwin";

const run = (cmd, args, opts = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    // Windows: `pnpm` is a `.cmd` shim — CreateProcess can't exec .cmd
    // directly, so we need the shell to resolve it.
    shell: isWindows,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed with status ${result.status}`,
    );
  }
};

// `--build-sea` writes to the literal `output` field from sea-config.json.
// We add `.exe` only at the final location.
const sourceBinName = "braintrust-setup";
const destBinName = isWindows ? "braintrust-setup.exe" : "braintrust-setup";

rmSync("dist-sea", { recursive: true, force: true });
rmSync("dist-sea-build", { recursive: true, force: true });
mkdirSync("dist-sea", { recursive: true });
mkdirSync("dist-sea-build", { recursive: true });

run(process.execPath, ["--build-sea", "sea-config.json"]);

renameSync(sourceBinName, `dist-sea/${destBinName}`);

if (isMac) {
  run("codesign", ["--sign", "-", `dist-sea/${destBinName}`]);
}
