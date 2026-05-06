# braintrust-wizard

CLI wizard to get your project set up with Braintrust.

The default wizard is implemented with Clack. The original fullscreen Ink +
React experience is preserved as the beau variant.

The beau implementation is actively being worked on and is intended to replace
the Clack implementation in the future. Until that switch happens, default
feature work should go into the Clack implementation unless beau work is
explicitly requested.

## Setup

```sh
mise install
pnpm install
```

## Commands

```sh
pnpm start
pnpm build
pnpm start:beau
pnpm build:beau
pnpm test
pnpm lint
pnpm format
pnpm format:check
```

## Backend

The Clack wizard talks to `https://www.braintrust.dev` by default. Set
`BRAINTRUST_WIZARD_BACKEND_URL` to point it at another Braintrust backend, for
example:

```sh
BRAINTRUST_WIZARD_BACKEND_URL=http://localhost:3000 pnpm start
```
