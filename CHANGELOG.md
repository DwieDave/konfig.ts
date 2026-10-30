# Changelog

All `@konfig.ts/*` packages are versioned in lockstep. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 0.5.0

0.5.0 is a breaking release. See [Migrating from 0.4](#migrating-from-04) below.

### Requirements

- **`effect` peer raised to `^4.1.0`** (was `^4.0.0`) in every package; `@effect/platform-node` is now `^4.1.0`. The old floor could not be met: every `@effect/platform-node` 4.0.x pulls `@effect/platform-node-shared` 4.1.x, which requires effect 4.1, so effect 4.0.x consumers crashed with `Cannot find module 'effect/net/AddressResolver'`.

### Breaking: output and behaviour

- **Output file names.** Rendered files of namespaced objects are named `<Kind>-<name>@<namespace>.yaml` (was `<Kind>-<name>.yaml`); `.`, `/` and `@` in any part become `-`. Cluster-scoped objects and Argo CD `Application` CRs keep their names. Clashes that remain fail with `OutputFileCollision`. The next `konfig build` renames these files.
- **Invalid YAML fails.** YAML with syntax errors or duplicate keys now fails with `YamlParseError` instead of being parsed leniently.
- **`konfig graph`** renders the tree view only. `--width` is removed, and dev edges are marked `(dev)` instead of `▽`.
- **sops**
  - `Sops.backend` encrypts only `data`/`stringData` by default (new `encryptedRegex` option). Before, real `sops` also encrypted `apiVersion`/`kind`/`metadata`, and the render failed.
  - `Sops.passthrough` files must hold exactly one `secretTemplates` entry, and it must cover every contract key.
- **external-secrets:** `target.name` is always the bound secret's name, so the `name` option is gone. `refreshInterval` takes Go durations (`"1h30m"`, `"500ms"`, `"0"`); an invalid value fails the render with `RenderError`.
- **argocd**
  - An app's `syncPolicy` merges over `defaults.syncPolicy` field by field. Use `automated: { enabled: false }` to opt out of a default `automated` block.
  - `Sync.wave` accepts integers only.
  - `Sync.options([])` returns `{}`.
- **Generated Dockerfiles change:**
  - Installs use `--frozen-lockfile`/`--immutable`.
  - A `sources` stage keeps dev `node_modules` out of the runner.
  - Aux files such as `bunfig.toml` are copied only if they exist.
  - `COPY` paths are quoted.
  - Debian images get Debian user commands.
  - `ENV` values escape `$`.
  - The workspace closure follows dependencies by name, so semver ranges work for npm and yarn-classic, and the builder stage also gets workspace `devDependencies`.
  - Re-run `konfig docker write`.
- **Docker spec validation** runs on every `emit` (`SpecInvalid`): secret-looking `ENV` values, out-of-range ports and unacceptable health-check paths fail. `engines.*` must be exact or `major(.minor)` (`EngineVersionInvalid`); Yarn Plug'n'Play is rejected (`UnsupportedYarnLinker`); an incompatible package-manager/runtime pair fails (`PmRuntimeIncompatible`).

### Breaking: API changes

**@konfig.ts/core**

- **Signatures:** `unsafeCoerce({ value, reason })`, `runProcessString({ command, ... })` and `runProcessExit({ command, ... })` take one object.
- **Removed, rendering:** `render` (use `konfig build`, `renderAllYaml`/`renderAllYamlEffect` or `renderManifest`), `Manifest.combine`, `Manifest.whenever`, `Manifest.ManifestTypeId`.
- **Removed, composition:** `Bundle.make`, `Bundle.makeSet`, `Bundle.entrypoint`, `Compose.composeLayers`, `Compose.makeResidualEntrypoint`, `Module.asLiteralName`.
- **Removed, dependency needs:** `Dep.ConfigMap`, `Dep.Pvc`, `Dep.ServiceAccount`, `Dep.provideConfigMap`, `Dep.providePvc`, `Dep.provideServiceAccount`, and the `ServiceAccountRef` type (now in `@konfig.ts/k8s`).
- **Removed, config:** `decodeKonfigConfigSync`/`decodeKonfigConfigEffect`, `makeStrictDecoder`, and the sub-schemas `ClusterSpec`, `CrdConfig`, `DiffConfig`, `EnvEntry`, `HelmConfig`, `OutDir`, `ServicesConfig` (`KonfigConfig` remains).
- **Removed, YAML, diff and images:** `parseYaml` (use `parseYamlAll`/`parseYamlWith`), `deepEqual`, `redact`, `redactedEqual`, `lookupEnv`, `lookupEnvEffect`, `requireImageEffect`, `EnvImages`.
- **Removed, Helm:** `Helm.verifyChartDigest`, `Helm.versionTimeout` (`Helm.ensureChartTarball` and `Helm.assertMinVersion` are new), `DEFAULT_HELM_TIMEOUT_SECONDS`, `DEFAULT_HELM_VERSION_TIMEOUT_SECONDS`, `KONFIG_HELM_TIMEOUT_ENV`.
- **Removed, error classes and subprocess:**
  - `HelmRenderError`, `HelmVersionTooLow`, `HelmDigestMismatch` and `EmbedYamlReadError` are no longer exported. Match them by `_tag`; they still appear in `AnyRenderError`.
  - `ProcessError`, `ProcessTimeout`, `processDetail`.

**@konfig.ts/env**

- `Literal.define({ schema })` takes a string codec (`Schema.Codec<T, string>`), decoded from `envName`; it used to take a `Config`.
- **Removed:** `environmentLayer`, `typedKeys`, `collectByKey`, `EnvNameCollision` (still thrown; match by `_tag`).

**@konfig.ts/k8s**

- `EnvVar.secretEnv({ ref, map, optional? })` and `EnvVar.configMapEnv({ ref, map, optional? })` take one object; they used to take `(ref, map, opts)`.
- **Removed:** `EnvVar.fromSecretForPod` (use `EnvVar.fromSecret`), `SecretRef.unsafeReNamespace`, `reloader: "stakater-strict"` (it behaved like `"stakater"`).
- **Backend authors:** the `SecretBackend`/`BackendEmitInput`/`BackendTag` contract is replaced by the `Backend` kit (`Backend.define`, `Backend.encrypting`, `Backend.plainSecret`, `Backend.secretMeta`).
- `Workload.cron` returns `Manifest<Array<ServiceAccount | CronJob>>` (was a tuple).

**@konfig.ts/argocd**

- **Removed:**
  - `Application.make`, `AppOfApps.make` and `AppOfApps.entrypoint` (export `AppOfApps.fromModules` directly).
  - `buildCR` and `emitApplicationCR` (use `serializeApplicationCR`/`applicationCRFilename`).
  - The `repoURL`/`branch`/`rootPath` fields of `AppOfAppsTarget`, which nothing read.

**@konfig.ts/docker**

- The barrel is reduced to `Docker`, `DockerApp`, `isDockerApp`, `emit`, `extractHeader`, `HEADER_MARKER`, `findRoot`, `allWorkspaces`, `closureOf`, `lookupWorkspace`, `workspaceDeps`, `Workspace`, `AnyDockerError` and `CircularWorkspaceDep`. All other docker errors are matched by `_tag`.
- **Removed:**
  - The spec and atom schemas (`DockerSpec`, `RunnerSpec`, `DevSpec`, `*Atom`), `decodeDockerSpec`/`decodeDockerSpecSync`.
  - The pipeline internals (`lower`, `buildIR`, `prepareContext`, `validateSpec`, `render`, `renderFile`, `renderHeader`, `sha256Hex`).
  - The package-manager and runtime implementations (`bunPm`, `npmPm`, `pnpmPm`, `bunRuntime`, `nodeRuntime`), `detectPm`, `makeDockerApp`, `DockerAppTypeId`, `PACKAGE_NAME`.
  - `Docker.platform.multi`.

**@konfig.ts/sops**

- **Removed:** `Sops.source`, `sopsDecrypt`, `sopsEncryptStdin`, `SopsInvocationError`. Failures surface as `RenderError` with the subprocess failure as `cause`.

**@konfig.ts/sealed-secrets**

- **Removed:** `runKubeseal`, `resolveCertPath`, `KubesealCertMissing`, `KubesealInvocationError`, `KubesealParseError`. Failures surface as `RenderError`.

**CLI**

- **Removed:** `build --verbose` (use the global `--log-level debug` for the full cause), `graph --width`.
- `docker` replaces `--prod-only`/`--dev-only` with `--only prod|dev`.

### Added

- **core:**
  - `Helm.release({ clusterScopedKinds })`.
  - Cluster scope is read from CRDs shipped in the chart.
  - OCI chart repositories.
  - Helpers: `findUp`, `existsOrFalse`, `orElseIfNotFound`, `readOrEmpty`, `runProcessCollect`, `runProcessWithStdin`, `runCliWithStdin`, `sha256Hex`, `omitUndefined`, `flattenDocs`, `parseYamlWith`, `decodeYamlOutput`.
  - Errors: `YamlParseError`, `HelmMinVersionInvalid`.
- **k8s:** the `Backend` kit; the `ServiceAccountRef` brand with `ServiceAccountRef.of`.
- **sops:** `Sops.backend({ encryptedRegex, timeout })`; support for `unencrypted_regex` and the `*_suffix` rules; all AWS partitions and Azure clouds in recipients.
- **sealed-secrets:** labels, annotations and the Secret `type` are forwarded to the sealed Secret.
- **docker:** an explicit `Docker.pm.yarn({ variant })` wins over detection; `yarnPath` release files are copied; negated (`!x`) and partial (`web-*`) workspace globs.
- **CLI:** `docker write --out-dir` creates the directory; the build cache hashes `KONFIG_*`/`KUBESEAL_*` env vars and the lockfiles.

### Fixed

- **YAML:** values ending in newlines, plus `Date`, `Map` and `Set`, round-trip through `serialize`. `renderAllYaml` skips `null`/`undefined` outputs instead of crashing.
- **Helm:**
  - An unparseable `minVersion` fails instead of skipping the check, and prereleases follow semver.
  - Digests compare case-insensitively, so a mismatch no longer deletes the cache each run.
  - A failed `helm version` probe is no longer cached, and concurrent probes and pulls are single-flight.
  - Renders run at most 4 at a time.
  - Values are quoted for YAML 1.1, and the kube version is forwarded.
- **Diff and lookups:** `diffFiles` no longer hides a change when a file has duplicate documents. Image lookups ignore prototype keys (`"constructor"`, `"toString"`).
- **env:** two `Literal.define` calls sharing one config no longer return the same object.
- **k8s:**
  - Each secret's source resolves once per render (one `sops --decrypt`).
  - Builders never alias caller input.
  - `Environment.bind` handles members named `source`, `backend` or `_tag`.
- **CLI**
  - **validate:** `validate --strict` passes kubeconform flags before the directory.
  - **build output and cache:**
    - Output paths reject `../` in env, cluster and app names.
    - An empty render no longer deletes the previous output.
    - `build dev` no longer wipes per-cluster output.
    - The build cache matches `{a,b}` globs, ignores `.git` and output dirs, and is safe on symlink cycles.
    - The Helm cache resolves from the config directory.
  - **crd:**
    - `crd extract` no longer pulls an unverified chart.
    - CRD extraction fails loudly on parse and compile errors and prefers the storage version.
    - `crd verify` fails on an empty or broken registry.
  - **other commands:**
    - `diff --cluster` compares against the right baseline.
    - `docker diff` compares content, not just the header hash.
    - `konfig set` ignores prototype keys.
    - Errors are printed once.
- **external-secrets:** `refreshInterval` accepts every Go duration.

### Internal

- The anti-slop oxlint rules are vendored at `tools/oxlint/anti-slop/`, and all rules run at `error`.
- CI now:
  - fails on lint warnings
  - checks formatting (`bun run fmt:check`)
  - runs `docker build` on every generated fixture Dockerfile (`docker-e2e`)
  - runs the peer-floor job at effect 4.1.0
- The `konfig.ts` example (`examples/full-stack`) builds again, and its images build and start.

## Migrating from 0.4

1. **Upgrade Effect:** `effect@^4.1.0` (and `@effect/platform-node@^4.1.0` if you depend on it directly).
2. **Rebuild and commit the renamed manifests.** Run `konfig build <env>` for every env and commit the renamed `…@<namespace>.yaml` files. Update anything that references rendered file paths, such as Argo CD `directory.include` patterns, scripts or diff baselines.
3. **Regenerate Dockerfiles** with `konfig docker write <target> --force`. Make sure every app declares the workspace packages it imports, because only declared dependencies reach the image.
4. **Literals:** pass a string codec instead of a `Config`:
   ```ts
   // 0.4
   Literal.define({ envName: "HTTP_PORT", value: 8080, schema: Config.Number("HTTP_PORT") })
   // 0.5
   Literal.define({ envName: "HTTP_PORT", value: 8080, schema: Schema.FiniteFromString })
   ```
5. **Batch env vars:**
   ```ts
   // 0.4
   EnvVar.secretEnv(db.ref, { DATABASE_URL: "url" }, { optional: true })
   // 0.5
   EnvVar.secretEnv({ ref: db.ref, map: { DATABASE_URL: "url" }, optional: true })
   ```
   `EnvVar.fromSecretForPod(...)` becomes `EnvVar.fromSecret(...)`.
6. **Removed core helpers:**
   - Replace `render(...)` with `konfig build`, or `renderAllYaml`/`renderManifest` in scripts.
   - Replace `Manifest.combine` with `Manifest.concat`.
   - Inline `Manifest.whenever` as a conditional.
7. **sops:**
   - If your sops files rely on encrypting more than `data`/`stringData`, pass `encryptedRegex`.
   - Split passthrough files with several `secretTemplates` into one file per secret.
   - Replace `Sops.source` with `Sops.backend` or `Sops.passthrough`.
8. **ExternalSecrets:** drop `target.name`.
9. **Argo CD:**
   - Replace `AppOfApps.entrypoint(x)` with `x`.
   - Replace `Application.make`/`AppOfApps.make` with `Application.define`/`AppOfApps.fromModules`.
   - Remove `repoURL`/`branch`/`rootPath` from `AppOfAppsTarget`.
   - Make `Sync.wave` arguments integers.
10. **Docker:**
    - Replace `--prod-only`/`--dev-only` with `--only prod|dev`.
    - Pin `engines.*` to exact or `major(.minor)` versions.
    - Switch Yarn Berry repos on Plug'n'Play to `nodeLinker: node-modules`.
    - Drop `Docker.platform.multi`.
11. **Error handling:** errors that are no longer exported (`HelmRenderError`, `HelmVersionTooLow`, `HelmDigestMismatch`, `EnvNameCollision`, the docker errors other than `CircularWorkspaceDep`, and the `Kubeseal*` and `Sops*` errors) are matched by `_tag`. Backend subprocess failures arrive as `RenderError` with the original failure as `cause`.
12. **Custom secret backends:** port them to `Backend.define` (see `@konfig.ts/k8s` → Backend kit).
