# Changelog

All notable changes to konfig.ts are documented here. Format:
[Keep a Changelog](https://keepachangelog.com); semantics:
[SemVer](https://semver.org).

## [Unreleased]

The 0.0.x experimentation is being squashed into a single
"Initial release" entry on 1.0.0. Until then, this section tracks
the work milestones from `.docs/workflows/review-plan.md`.

### Added

- M0: schema validation at every external-process boundary
  (sops/kubeseal stdout, sops recipients, CRD extractor inputs).
- M0: `HelmDigestMismatch` — SHA-256 of the cached chart tarball is
  verified after every pull and on every cache hit.
- M1: `requiresSource` on `SecretBackend<N, K, RequiresSource>` —
  missing source on a Sops/SealedSecrets/NativeSecret backend is now a
  compile error.
- M1: type-level envName collision detection on `defineEnvironment`;
  runtime throw retained as defense-in-depth.
- M1: `LiteralName<T>` enforced on `Application.define`'s `name` and
  `namespace` so a `string`-widened arg fails at the call site.
- M1: `Application.test.ts` locks the single Object.assign cast in
  `_attachLayerToTag`.
- M1: `RenderContext` widens with `cluster`, `k8sVersion`, `flags`;
  `--cluster`/`--k8s-version`/`--flag k=v` on `build`/`validate`/`diff`.
- M1: `unsafeCoerce(value, reason: string)` replaces every production
  `coerce<T>(value)` call; reasons are auditable.
- M2: `validate` now performs structural validation; `--strict` shells
  out to kubeconform.
- M2: `Environment.runtime(env)` returns the decoded record from the
  same bundle that drove `Environment.bind`.
- M2: multi-doc diff keyed by (kind, namespace, name), optional
  numeric normalization.
- M2: Yarn (classic + berry) joins the Dockerfile PM matrix.
- M2: `Workload.web({ reloader: ... })` for stakater/Reloader
  annotations.
- M2: atomic file writes in `konfig build` (stage to `<outDir>.tmp`
  then rename).
- M3: example apps consume their env contract via
  `Environment.runtime(apiEnv)`.
- M3: real digests on the example's chart pins.
- M3: multi-cluster example overlays (`prod-eu.ts`, `prod-us.ts`).
- M3: failing-example gallery covers six error categories.
- M3: top-level README + `.docs/architecture.md` rewrite.
- M5: sops decryption per file (replaces per-key sops --extract
  loop).
- M5: parallel inter-app render via `Effect.all([...], { concurrency:
  4 })`.
- M5: `--log=text|json` and `--verbose` on `konfig build`, per-phase
  timing report.
- M4: snapshot tests for every common K8s kind in the YAML
  serializer.
- M4: property tests for the workspace graph closure.
- M6: `app/no-multiple-function-params` gains a `scope: "all" |
  "exports"` option; defaults to `"exports"`.
- M6: `app/no-comments` recognizes `// konfig: WHY ...` as an
  exemption.

### Changed

- M0: every shell-out in `packages/cli/**` and
  `packages/docker/**` now uses `ChildProcessSpawner` with argv
  arrays. Helm version detection migrated to the same path.
- M0: `coerce<T>(value)` is deprecated. Production code uses
  `unsafeCoerce(value, reason: string)`; the deprecated alias remains
  for test fixtures.
- M0: package READMEs (`core`, `k8s`) rewritten to reflect the
  Manifest<A> + Layer-based design.
- M1: `kubernetes-types` is pinned to an exact patch version.
- M1: `ContainerInput` extends `K8sContainer` (every K8s container
  field is now accepted at konfig's surface).
- M2: `Helm.release` always verifies digest — flipping a byte in a
  cached tarball fails the next render.

### Fixed

- M0: shell injection in `cli/crd/extract.ts` (CVE-class — chart
  name/repo/version were `.join(" ")`-ed into `/bin/sh -c`).
- M0: sops recipient arrays are validated per kind (age, KMS, GCP
  KMS, Azure KV, PGP); a comma inside a recipient string is now
  rejected at decode time rather than silently split by sops.
- M0: sops/kubeseal stdout is schema-validated; malformed output
  produces a `BoundaryDecodeError` instead of a coerced partial
  manifest.
- M2.3: Dockerfile lowering picks the bun lockfile that actually
  exists (`bun.lock` or `bun.lockb`) rather than COPY-ing the first
  listed.
- M2.5: helm version parser preserves pre-release suffixes
  (`v3.16.0-rc.1` no longer truncates to `3.16.0`).

### Removed

- M0: `packages/core/src/Manifest.test.ts` (property test of a
  type algebra that no longer exists in the codebase).
- M0: `packages/core/src/types.ts` (unused `Kind`/`KINDS`
  re-export).

### Security

- M0.1 (shell injection): see Fixed.
- M0.2 (Helm digest): see Added.
- M0.3 (sops/kubeseal output schemas): see Fixed.
- M0.4 (sops recipient validation): see Fixed.
