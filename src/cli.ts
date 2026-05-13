import * as prompts from "@clack/prompts";

import { runClackWizard, WizardCancelledError } from "./clack-wizard";
import { parseArgs } from "./options";

await parseArgs(process.argv.slice(2), process.env);

try {
  await runClackWizard(prompts);
} catch (error) {
  if (error instanceof WizardCancelledError) {
    process.exit(0);
  }

  throw error;
}
