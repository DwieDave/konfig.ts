# Versioning policy

konfig.ts ships from a single repo to NPM as multiple `@konfig.ts/*`
packages. This document records the policy for how those packages
version, release, and depend on each other.

## Strategy: lockstep, single repo-wide version

Every `@konfig.ts/*` package shares the same version number. A release
bumps every package, regardless of whether each individual package
changed. The reasons:

- **Cross-package coupling is the norm.** `@konfig.ts/k8s` reaches
  into `@konfig.ts/core` for `Manifest`, `Dep.*`, and the error union;
  `@konfig.ts/sops` reaches into `@konfig.ts/k8s` for `SecretBackend`.
  Pinning a single tag across the tree means consumers don't have to
  reason about a matrix of compatible versions.
- **The user-facing contract is the CLI + the example.** Both are
  pinned to the same versions of every dependency anyway.
- **Effect's beta dependency lives in the catalog.** When that bumps,
  every package's published artifact recompiles against the new
  Effect; staggered releases would mean a beta-window where one
  package's published types disagree with another's.

The trade-off: a docs-only fix in `@konfig.ts/sops` still bumps every
other package's version. We accept that, given the dependency graph.

## Inter-package dependencies

Workspace dependencies are declared as `"workspace:*"` in source. At
publish time, `workspace:*` is rewritten to the exact published
version (handled by the publish workflow — see M6.6 in the roadmap).
Consumers of the published packages see exact pins, so a 1.0.0 of
`@konfig.ts/k8s` always asks for 1.0.0 of `@konfig.ts/core`.

## SemVer interpretation

Each tier in [`public-api.md`](./public-api.md) determines what
counts as breaking:

- `stable` — removal, signature narrowing of an input, or signature
  widening of an output is a **major** change. New optional fields,
  broader input types, additive exports are **minor**.
- `experimental` — any change is allowed on a minor; we'll call them
  out in `### Changed` of the changelog.
- `internal` — patch-level fair game.

A bug fix that changes user-visible behavior but corrects a regression
or restores documented behavior is a `### Fixed` minor.

## Pre-1.0

Until 1.0.0 the catalog pins `effect` to the exact beta the codebase
was developed against. See [`compat.md`](../compat.md). Effect bumps
are intentional and trigger a minor release.

## Tooling

The intended publish flow:

1. Run `bun changeset` (TBD — adoption tracked under M6.4) to write a
   changeset describing the change.
2. CI rolls every package's version forward, rewrites `workspace:*`
   to the new version, updates the lockfile, tags `vX.Y.Z`.
3. The tag triggers `.github/workflows/release.yml` (M6.6) which
   publishes every `@konfig.ts/*` package with `--provenance`.

We do NOT use `lerna` or `nx` for release orchestration; the policy
above is simple enough that a single shell script plus
[`changesets`](https://github.com/changesets/changesets) covers it.

## Why not independent versions?

We considered them. The tipping point against was the cross-package
coupling described above plus the small total number of packages (9).
For a larger surface (say, a Crossplane integration package landing
later, or a Helm operator wrapper) we'd revisit.
