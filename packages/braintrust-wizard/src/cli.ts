import { spawnSync } from "node:child_process";

import * as prompts from "@clack/prompts";

import {
  buildDefaultDeps,
  runClackWizard,
  WizardCancelledError,
} from "./clack-wizard";
import { parseArgs } from "./options";
import {
  startTelemetry,
  finishTelemetry,
  markTelemetrySigint,
} from "./telemetry";

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

startTelemetry(process.env);

const deps = buildDefaultDeps({
  options,
  prompts: prompts as unknown as Parameters<
    typeof buildDefaultDeps
  >[0]["prompts"],
});

try {
  await runClackWizard(deps);
  finishTelemetry();
} catch (error) {
  if (error instanceof WizardCancelledError) {
    markTelemetrySigint();
    finishTelemetry();
    process.exit(0);
  }
  finishTelemetry();
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}
