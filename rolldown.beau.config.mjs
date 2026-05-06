import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/beau/cli.tsx",
  output: {
    banner: "#!/usr/bin/env node",
    codeSplitting: false,
    file: "dist/cli.beau.js",
    format: "esm",
    sourcemap: true,
  },
  platform: "node",
  external: [/^node:/],
});
