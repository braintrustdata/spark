import {
  buildDefaultDeps,
  runClackWizard,
  WizardCancelledError,
} from "./clack-wizard";
import { parseArgs } from "./options";

const options = await parseArgs(process.argv.slice(2), process.env);

const deps = buildDefaultDeps({ options });

let handlingSignal = false;
const removeSignalHandlers = () => {
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
};
const handleSignal = (signal: "SIGINT" | "SIGTERM") => {
  if (handlingSignal) return;
  handlingSignal = true;
  void deps.setupEvents
    .terminate({
      outcome: "cancelled",
      failureCategory: "cancelled",
      reasonCode: "user_interrupt",
    })
    .finally(() => {
      removeSignalHandlers();
      process.kill(process.pid, signal);
    });
};
function onSigint() {
  handleSignal("SIGINT");
}
function onSigterm() {
  handleSignal("SIGTERM");
}

process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

try {
  await runClackWizard(deps);
} catch (error) {
  if (error instanceof WizardCancelledError) {
    process.exitCode = 0;
  } else {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
} finally {
  if (!handlingSignal) removeSignalHandlers();
}
