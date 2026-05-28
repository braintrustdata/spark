# spark Agent Guide

## Project Overview

`spark` is a TypeScript CLI/TUI for setting up Braintrust projects. The default wizard currently uses Clack for terminal prompts. The beau variant keeps the original fullscreen Ink + React implementation; it is actively being worked on and is intended to replace the Clack implementation in the future. The project also uses TanStack Query for backend communication, Vitest for tests, ESLint for linting, Prettier for formatting, pnpm for package management, mise for tool pinning, and Rolldown for the build pipeline.

`spark` is only the name of this repository. It should never be user-facing in product names, CLI copy, command output, prompts, UI, or user-facing docs.

The project is currently an early bootstrap. The default Clack wizard starts with browser-mediated sign-in, then continues into coding-tool instrumentation. The beau variant still starts by asking whether the user already has a Braintrust account, then asks whether the browser should be opened for login.

Default implementation work should go into the Clack implementation. Do not work on the beau implementation unless the user explicitly asks for beau or Ink work.

## Tooling

- Use Node `24.15.0` and pnpm `10.33.3` through mise.
- Install dependencies with `pnpm install`.
- Run the default Clack wizard with `pnpm start`.
- Build both the default Clack wizard and the beau Ink wizard with `pnpm build`.
- Run the beau Ink wizard with `pnpm start:beau`.
- Run tests with `pnpm test`.
- Run ESLint with `pnpm lint`.
- Format with `pnpm format`; check formatting with `pnpm format:check`.

## Architecture Guidelines

- Use Clack for the default prompt flow.
- Treat the Clack implementation as the current production/default path.
- Treat the beau Ink implementation as active future replacement work, but do not modify it unless explicitly requested.
- Use React Context plus reducers for global TUI state management in the beau Ink variant.
- It is fine for reducer state to churn while the beau TUI evolves. Any beau TUI change may fully refactor the reducer state shape when the new shape makes more sense.
- Use local React state for state that is truly local to a beau component or interaction.
- Always use React Query to communicate with the backend.
- Keep beau Ink UI components focused on rendering and input handling.
- Keep backend/API request logic out of presentation components; expose it through query or mutation hooks.

## Workspace Layout

This is a pnpm workspace. All packages live under `packages/`.

- `packages/spark/` — the main wizard CLI (Clack + beau variants).

Root-level scripts (`pnpm build`, `pnpm lint`, etc.) delegate to the packages through Turborepo.

## Implementation Notes

- Wizard source files live under `packages/spark/src/`.
- Wizard tests live under `packages/spark/test/`.
- The default CLI entrypoint is `packages/spark/src/cli.ts`; Rolldown emits `packages/spark/dist/cli.mjs`.
- The beau CLI entrypoint is `packages/spark/src/beau/cli.tsx`; Rolldown emits `packages/spark/dist/cli.beau.js`.
- Put all default Clack wizard user-facing copy in `packages/spark/src/clack-copy.ts`, organized by wizard flow. `clack-wizard.ts` should reference `CLACK_WIZARD_COPY` and keep only control-flow identifiers/sentinels inline.
- `packages/spark/src/query-client.ts` owns QueryClient creation and should remain the central place for query defaults.
- Do not add SEA packaging yet; the current build targets are JavaScript bundles.
