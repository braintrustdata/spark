import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/cli.tsx",
  output: {
    banner: "#!/usr/bin/env node",
    codeSplitting: false,
    file: "dist/cli.js",
    format: "esm",
    sourcemap: true,
  },
  platform: "node",
  external: [/^node:/],
});
