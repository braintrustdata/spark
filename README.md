# spark

CLI wizard to get your project set up with Braintrust.

## Install

### WIP

Soon, `curl -fsSL https://braintrust.dev/spark.sh | sh` will work and:

- install `bt` if missing (latest stable version)
- install the latest `spark` version
- launch `spark`

#### extra WIP

Publish as `npm` package?

### Options (POSIX)

Pass a version as a positional argument after `sh -s --`:

```sh
# Latest stable (default)
curl -fsSL https://braintrust.dev/cli/spark.sh | sh

# Latest canary / prerelease
curl -fsSL https://braintrust.dev/cli/spark.sh | sh -s -- canary

# Pinned tag
curl -fsSL https://braintrust.dev/cli/spark.sh | sh -s -- v0.0.1
```

Supported environment variables (set them before `curl`):

- `XDG_BIN_HOME` — install directory for the `spark` binary. Defaults to `~/.local/bin`.

On the first run, `spark` will install the custom `pi` harness to `~/.cache/spark/<sha256-prefix>/spark-harness/`, entrypoint in `~/.cache/spark/<hash>/spark-harness/bin/spark-harness.mjs`.

## Development

```sh
mise install
pnpm install
```

### Building the bundled binary

```sh
pnpm build:sea
```

will build `dist-sea/spark`.
See https://nodejs.org/api/single-executable-applications.html (NodeJS 26.1.0) for details.

## Untested behavior

`--ca-cert` (used to point at a self-signed certificate, for example for a self-hosted Braintrust) is untested.

## Beau variant

WIP
