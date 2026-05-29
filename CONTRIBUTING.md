# Contributing

## Setup

Use the toolchain pinned by mise:

```sh
mise install
pnpm install
```

Useful commands:

```sh
pnpm start
pnpm start:beau
pnpm build
pnpm build:sea
pnpm test
pnpm lint
pnpm format:check
```

`pnpm start` builds and runs the default Clack wizard. `pnpm start:beau` builds and runs the beau Ink wizard.

## Default Wizard and Beau

The Clack wizard is the current default implementation and production path. Default wizard work should go through the Clack implementation.

The beau variant is the fullscreen Ink and React implementation. It is under active development and is intended to replace the Clack implementation later. Only change beau code when the task explicitly asks for beau or Ink work.

## Releases

Stable releases use the manual `Release` workflow.

1. Dispatch the workflow from `main`.
2. Enter the exact stable version without a leading `v`, for example `0.0.3`.
3. Approve the `release` environment deployment when GitHub asks for release approval.

The workflow validates the version, creates a timestamped `release/v<version>-<timestamp>` branch, commits the version bump to `packages/spark/package.json`, opens a PR, verifies the release commit, builds all binary artifacts, and creates the GitHub Release for `v<version>`. After the release succeeds, it enables auto-merge on the version-bump PR.

This repository uses `GITHUB_TOKEN` for release automation. Pull requests created by `GITHUB_TOKEN` may still need a human to approve PR workflow runs, and `main` requires review and passing checks. Auto-merge is enabled after publishing, but the PR may wait until those requirements are satisfied before the version bump lands on `main`.

Pre-releases use the manual `Pre-release` workflow.

1. Dispatch the workflow from the branch or tag that should provide the workflow definition.
2. Optionally enter a target ref, which may be a branch, tag, or commit SHA.
3. If no target ref is provided, the workflow releases the head of the selected branch or the selected tag.
4. The workflow reads the package version at the resolved target ref.
5. It creates a pre-release tag of the form `v<package-version>-pre.<shortsha>`.

Pre-releases build and publish artifacts from the selected commit. They do not create a branch, commit, or PR, and they are not marked as the latest release.
