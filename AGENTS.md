# braintrust-wizard Agent Guide

## Project Overview

`braintrust-wizard` is a TypeScript CLI/TUI for setting up Braintrust projects. It uses Ink with React for terminal rendering, TanStack Query for backend communication, Vitest for tests, ESLint for linting, Prettier for formatting, pnpm for package management, mise for tool pinning, and Rolldown for the build pipeline.

The project is currently an early bootstrap. The TUI renders a counter that increments when Enter is pressed and exits on Ctrl-C.

## Tooling

- Use Node `24.15.0` and pnpm `10.33.3` through mise.
- Install dependencies with `pnpm install`.
- Run the TUI with `pnpm start`.
- Build with `pnpm build`.
- Run tests with `pnpm test`.
- Run ESLint with `pnpm lint`.
- Format with `pnpm format`; check formatting with `pnpm format:check`.

## Architecture Guidelines

- Use React Context plus reducers for global TUI state management.
- Use local React state for state that is truly local to a component or interaction.
- Always use React Query to communicate with the backend.
- Keep the Ink UI components focused on rendering and input handling.
- Keep backend/API request logic out of presentation components; expose it through query or mutation hooks.

## Implementation Notes

- Source files live under `src/`.
- Tests live under `test/` and use `ink-testing-library`.
- The CLI entrypoint is `src/cli.tsx`; Rolldown emits `dist/cli.js`.
- `src/query-client.ts` owns QueryClient creation and should remain the central place for query defaults.
- Do not add SEA packaging yet; the current build target is a JavaScript bundle.
