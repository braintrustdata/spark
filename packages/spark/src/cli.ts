import {
  buildDefaultDeps,
  runClackWizard,
  WizardCancelledError,
} from "./clack-wizard";
import { parseArgs } from "./options";

const options = await parseArgs(process.argv.slice(2), process.env);

const deps = buildDefaultDeps({ options });

try {
  await runClackWizard(deps);
} catch (error) {
  if (error instanceof WizardCancelledError) {
    process.exit(0);
  }
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}
