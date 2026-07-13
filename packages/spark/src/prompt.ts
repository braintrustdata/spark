import { DEFAULT_APP_URL } from "./options";

export function renderPrompt(opts: {
  projectName: string;
  appUrl?: string | undefined;
}): string {
  const appUrlBullet =
    opts.appUrl !== DEFAULT_APP_URL
      ? `\n- Configure the Braintrust SDK initialization with app URL "${opts.appUrl}".`
      : "";

  return `Set up Braintrust tracing in this working directory. Follow these steps in order.

You are running as part of the Braintrust setup script, so don't concern yourself with that script. There are \`.env.braintrust\` and \`.braintrust.json\` files in the current working directory that hold a valid \`BRAINTRUST_API_KEY\` for the target organization. The Braintrust SDKs pick up this token automatically as long as they run with a working directory at or below these files. Don't read either file, and never put the actual API key value into code.

## Step 1: Detect the SDK

Look at the workspace and determine the right Braintrust SDK(s) to use. If the project spans more than one language, instrument each one. If the project is a monorepo, check the git root to get oriented, but only instrument applications in or below the current working directory.

## Step 2: Follow the SDK's configure tracing guide

For each SDK, read the matching page and follow its "Configure tracing" section. Do not follow any other Braintrust setup docs.

| SDK | Guide |
| --- | ------|
| Python | https://www.braintrust.dev/docs/sdks/python/install-and-instrument.md |
| TypeScript | https://www.braintrust.dev/docs/sdks/typescript/install-and-instrument.md |
| Go | https://www.braintrust.dev/docs/sdks/go/install-and-instrument.md |
| Java | https://www.braintrust.dev/docs/sdks/java/install-and-instrument.md |
| Ruby | https://www.braintrust.dev/docs/sdks/ruby/install-and-instrument.md |
| C# | https://www.braintrust.dev/docs/sdks/csharp/install-and-instrument.md |

## Step 3: Install and configure the SDK

- Install the SDK with the package manager the project already uses. Use the latest version: do web research to look it up and install that version rather than pinning to \`latest\`. Verify the install succeeded.
- Prefer auto-instrumentation over manual wrappers.
- Set the project name in the SDK initialization to "${opts.projectName || ""}".${appUrlBullet}

## Rules

- Add only tracing. Do not add evals or anything else.
- Make only the code changes needed to add tracing. Do not run application code, and do not break or meaningfully modify existing code.
- Be as concise and readable as possible with your code changes.
- Do not use the Braintrust CLI (\`bt\`).

Full documentation: https://www.braintrust.dev/docs/llms.txt`;
}
