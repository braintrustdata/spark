import { defineConfig } from "rolldown";

export default defineConfig([
  {
    input: "src/cli.ts",
    output: {
      banner: "#!/usr/bin/env node",
      codeSplitting: false,
      file: "dist/cli.mjs",
      format: "esm",
      sourcemap: true,
    },
    platform: "node",
    external: [/^node:/],
  },
  {
    input: "src/crank-telemetry.ts",
    output: {
      codeSplitting: false,
      file: "dist/crank-telemetry.mjs",
      format: "esm",
      sourcemap: true,
    },
    platform: "node",
    external: [/^node:/],
  },
]);
