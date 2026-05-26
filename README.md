# Braintrust Setup CLI

CLI wizard to get your project set up with Braintrust.

## Install

### WIP

Soon, `curl -fsSL https://braintrust.dev/cli/braintrust-setup.sh | sh` will work and:

- install the latest Braintrust Setup version
- launch Braintrust Setup

#### extra WIP

Publish as `npm` package?

### Options (POSIX)

Pass a version as a positional argument after `sh -s --`:

```sh
# Latest stable (default)
curl -fsSL https://braintrust.dev/cli/braintrust-setup.sh | sh

# Latest canary / prerelease
curl -fsSL https://braintrust.dev/cli/braintrust-setup.sh | sh -s -- canary

# Pinned tag
curl -fsSL https://braintrust.dev/cli/braintrust-setup.sh | sh -s -- v0.0.1
```

Supported environment variables (set them before `curl`):

- `XDG_BIN_HOME` — install directory for the `braintrust-setup` binary. Defaults to `~/.local/bin`.

During setup, Braintrust Setup discovers installed local coding tools and can run Claude Code or Codex non-interactively using the user's existing subscription or token. Use `--tool claude`, `--tool codex`, or `BRAINTRUST_SETUP_TOOL` to force a specific tool.

## Development

```sh
mise install
pnpm install
```

### Building the bundled binary

```sh
pnpm build:sea
```

will build `dist-sea/braintrust-setup`.
See https://nodejs.org/api/single-executable-applications.html (NodeJS 26.1.0) for details.

## Untested behavior

`--ca-cert` (used to point at a self-signed certificate, for example for a self-hosted Braintrust) is untested.

## Beau variant

WIP
