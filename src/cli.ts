import * as prompts from "@clack/prompts";

import { runClackWizard, WizardCancelledError } from "./clack-wizard";

try {
  await runClackWizard(prompts);
} catch (error) {
  if (error instanceof WizardCancelledError) {
    process.exit(0);
  }

  throw error;
}
