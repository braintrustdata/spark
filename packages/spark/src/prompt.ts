import { DEFAULT_APP_URL } from "./options";

export function renderPrompt(opts: {
  projectName: string;
  appUrl?: string | undefined;
}): string {
  let prompt = `Instrument the application in this working directory with Braintrust tracing.

- Look at the current workspace and instrument it with Braintrust tracing using the right Braintrust SDK(s).
- Don't add any evals or anything other than tracing.
- Exclusively follow the docs at https://www.braintrust.dev/docs/tracing-quickstart. Do not concern yourself with the braintrust setup script. You are running as part of that script.
- You can assume that there are \`.env.braintrust\` and \`.braintrust.json\` files at the current working directory. These files contain a \`BRAINTRUST_API_KEY\` token with a valid API key for the Braintrust organization we want to send data to. Assume that the Braintrust SDKs are able to pick up the local token automatically as long as they run with a working directory in a directory below or with these files. Don't read either file and never put the actual API key value into code.
- In terms of instrumentation, always prefer adding auto-instrumentation over manual wrappers.
- For the SDK initialization configure the project name "${opts.projectName || ""}".
- Do not run application code, just do code changes to instrument the application.
- Also install the SDK or multiple SDKs if necessary. Always use the latest version. Do web research or web requests to look up the latest version. Make sure to use the right package manager that the project is already using. Also look upwards in the directory structure to check whether you're in a mono-repo or not. Ideally go to the root of the git repository if present to verify, but only instrument applications in or below the current working directory. Verify that the SDK has actually been installed.
- Be as concise and readable as possible with your code changes.
- Do not break any application code. 
- Do not modify any application code in any meaningful way.
- Do not use the Braintrust CLI (\`bt\`).`;

  if (opts.appUrl !== DEFAULT_APP_URL) {
    prompt += `\n- Configure the Braintrust SDK initialization with app URL "${opts.appUrl}".`;
  }

  return prompt;
}
