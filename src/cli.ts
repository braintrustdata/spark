import * as prompts from "@clack/prompts";

import { runClackWizard, WizardCancelledError } from "./clack-wizard";
import { parseArgs } from "./options";

const { help } = await parseArgs(process.argv.slice(2), process.env);

if (help) {
  process.exit(0);
}

try {
  await runClackWizard(prompts);
} catch (error) {
  if (error instanceof WizardCancelledError) {
    process.exit(0);
  }

  throw error;
}
