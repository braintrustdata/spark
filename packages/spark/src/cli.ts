import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import * as prompts from "@clack/prompts";

import {
  buildDefaultDeps,
  runClackWizard,
  WizardCancelledError,
} from "./clack-wizard";
import {
  HARNESS_SENTINEL_ARG,
  PI_SENTINEL_ARG,
  resolveHarnessBinPath,
  resolveHarnessBootstrapPath,
  resolvePiBootstrapPath,
} from "./instrument";
import { parseArgs } from "./options";

// SEA binaries always run the embedded main, so to launch the harness from a
// SEA we re-exec ourselves with this sentinel. The injected main's
// built-in-only import restriction does not apply to file:// URLs loaded via
// dynamic import, so the extracted harness .mjs (and its native node-pty
// dependency) resolves normally.
if (process.argv[2] === HARNESS_SENTINEL_ARG) {
  const harnessBin = resolveHarnessBinPath();
  const bootstrap = resolveHarnessBootstrapPath();
  process.argv = [process.execPath, harnessBin, ...process.argv.slice(3)];
  createRequire(bootstrap)(bootstrap);
} else if (process.argv[2] === PI_SENTINEL_ARG) {
  // The harness re-execs us with `__pi <piJs> [args]` so pi runs as if it were
  // launched via `node <piJs>`. Bare `[execPath, piJs]` would just re-enter
  // this wizard, since `execPath` is the spark SEA binary.
  const piJs = process.argv[3];
  const bootstrap = resolvePiBootstrapPath(piJs);
  process.argv = [process.execPath, piJs, ...process.argv.slice(4)];
  createRequire(bootstrap)(bootstrap);
} else {
  const options = await parseArgs(process.argv.slice(2), process.env);

  // `NODE_EXTRA_CA_CERTS` is read once at Node startup, so we can't apply it
  // in-process. If --ca-cert (or BRAINTRUST_CA_CERT / SSL_CERT_FILE) was set
  // and the env var isn't already pointing at the same file, re-exec with it
  // applied. The guard env var prevents an infinite re-exec loop.
  const REEXEC_GUARD = "BT_WIZARD_REEXECED_FOR_CA";
  if (
    options.caCertPath &&
    process.env[REEXEC_GUARD] !== "1" &&
    process.env["NODE_EXTRA_CA_CERTS"] !== options.caCertPath
  ) {
    const result = spawnSync(process.execPath, process.argv.slice(1), {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: options.caCertPath,
        [REEXEC_GUARD]: "1",
      },
    });
    process.exit(result.status ?? 1);
  }

  const deps = buildDefaultDeps({
    options,
    prompts: prompts as unknown as Parameters<
      typeof buildDefaultDeps
    >[0]["prompts"],
  });

  try {
    await runClackWizard(deps);
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      process.exit(0);
    }
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }
}
