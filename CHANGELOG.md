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

The whole 0.4.0 public API is still exported, with these exceptions: `Bundle.entrypoint` and `AppOfApps.entrypoint` (deprecated no-op wrappers), `Docker.platform.multi` (it always failed at render), and the docker IR types `Arg` and `DepsImageInput` (their fields no longer exist). The remaining breaks are changed signatures and shapes:

**@konfig.ts/core**

- `render({ program, options? })`, `unsafeCoerce({ value, reason })`, `runProcessString({ command, options? })` and `runProcessExit({ command, options? })` take one object (they were positional).

**@konfig.ts/env**

- `Literal.define({ schema })` takes a string codec (`Schema.Codec<T, string>`) decoded from `envName`; it used to take a `Config`.
- `environmentLayer` keeps `ConfigError` in the layer's error channel (`Layer<Self, ConfigError>`); it used to turn a decode failure into a defect.

**@konfig.ts/k8s**

- `EnvVar.secretEnv({ ref, map, optional? })` and `EnvVar.configMapEnv({ ref, map, optional? })` take one object; they used to take `(ref, map, opts)`.
- `reloader: "stakater-strict"` is removed (it behaved like `"stakater"`).
- `Workload.cron` returns `Manifest<Array<ServiceAccount | CronJob>>` (was a tuple).
- `SecretBackend["_tag"]` is `string`, so custom backends can use their own tags. `BackendTag` is still the union of the built-in tags. The new `Backend` kit is the recommended way to write a backend.

**@konfig.ts/argocd**

- `AppOfApps.entrypoint` is removed; export `AppOfApps.fromModules` directly.
- `AppOfAppsTarget.repoURL`/`branch`/`rootPath` are optional (were required).

**@konfig.ts/docker** (pipeline-level exports changed shape with the generator rewrite)

- **Spec:**
  - `DockerSpec` has no `target` field; the target is passed to `emit`/`lower`.
  - `PlatformAtom` has no multi case.
  - `DockerApp[DockerAppTypeId]` is `true`.
- **Pipeline signatures:** `lower({ spec, target })`, `prepareContext({ spec, target })` and `decodeDockerSpecSync(input)` (the `options` argument is gone).
- **Types:**
  - `LowerContext` adds `buildClosure`; `EmitInput` adds `target`.
  - `PackageManager`: `_tag` becomes `kind`; `prodInstallCommand`/`productionFlag` become `prodInstall`; `depsImage` is removed; `supportFiles` is added.
  - `Runtime`: `_tag` becomes `kind`.
  - `DetectedPm` drops `presentLockfiles` and adds `yarnLayout`/`yarnPath`.
  - `closureOf({ target })` takes a `Workspace` and gains `includeDev?`.
  - IR: `Dockerfile` has no `args`, `PlatformIR` no `Multi`, `Expose` no `protocol`, and `HealthcheckIR` no `None` case.
  - `AnyDockerError` gains the new errors, and drops `SpecDecodeError`, `PlatformMultiUnsupported`, `DockerWriteRefused` and `DockerWriteError` (the last three are still exported classes).
- **Values:** `bunPm.installCommand` adds `--frozen-lockfile`, and `npmPm.nodeModulesLayout` is `"hoisted"`.

**@konfig.ts/sops**

- `SopsSourceInput.extract` is typed `(key, parsed: Schema.Json) => Schema.Json | undefined`.
- `sopsEncryptStdin` encrypts only `data`/`stringData` by default and accepts `encryptedRegex?`/`timeout?`.

**@konfig.ts/sealed-secrets**

- `KubesealInvocationError.cause` is typed `unknown` (it still holds the process failure).

**@konfig.ts/external-secrets**

- `ExternalSecretsBackendOptions.target` has no `name`, and `refreshInterval` is a `GoDuration`.

**Errors**

- Backend failures are `RenderError`s whose `cause` is the tagged error: `SopsInvocationError`, `KubesealCertMissing`, `KubesealInvocationError`, `KubesealParseError` or `BoundaryDecodeError`. Match on `cause._tag` or the exported classes.

**CLI**

- `build --verbose` is removed; use the global `--log-level debug` for the full cause. `graph --width` is removed.
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
  - fails when a published package's public API (runtime exports, types, namespace members) differs from the committed `api-surface.json` (`bun run api:check`; update it with `bun scripts/cli.ts api-surface --write`)
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
5. **Object parameters:**
   ```ts
   // 0.4
   EnvVar.secretEnv(db.ref, { DATABASE_URL: "url" }, { optional: true })
   render(program, { env: "prod" })
   unsafeCoerce<T>(value, "reason")
   // 0.5
   EnvVar.secretEnv({ ref: db.ref, map: { DATABASE_URL: "url" }, optional: true })
   render({ program, options: { env: "prod" } })
   unsafeCoerce<T>({ value, reason: "reason" })
   ```
6. **`environmentLayer`:** handle or `orDie` the `ConfigError` the layer can now fail with.
7. **sops:**
   - If your sops files rely on encrypting more than `data`/`stringData`, pass `encryptedRegex`.
   - Split passthrough files with several `secretTemplates` into one file per secret.
8. **ExternalSecrets:** drop `target.name`.
9. **Argo CD:**
   - Replace `AppOfApps.entrypoint(x)` with `x`.
   - Make `Sync.wave` arguments integers.
   - If you relied on `automated` defaults being replaced wholesale, use `automated: { enabled: false }`.
10. **Bundle:** replace `Bundle.entrypoint(x)` with `x`.
11. **Docker:**
    - Replace `--prod-only`/`--dev-only` with `--only prod|dev`.
    - Pin `engines.*` to exact or `major(.minor)` versions.
    - Switch Yarn Berry repos on Plug'n'Play to `nodeLinker: node-modules`.
    - Drop `Docker.platform.multi`.
    - If you call the pipeline directly (`lower`, `prepareContext`, the pm/runtime objects), apply the shape changes above.
12. **Error handling:** backend subprocess failures arrive as `RenderError` with the tagged error as `cause`.
