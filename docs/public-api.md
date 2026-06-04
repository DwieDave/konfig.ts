# Public API surface — 1.0 contract

Every export from a `@konfig.ts/*` package falls into one of three
stability tiers. The package's `index.ts` barrel is the source of truth
for what's exported; this doc names the stability level.

## Stability tiers

- **`stable`** — Frozen for 1.x. Removals or breaking signature
  changes require a major version bump. Bug fixes and additive
  improvements (new optional fields, broader input types) are allowed
  on minor versions.
- **`experimental`** — Exported, but the contract may change without a
  major bump. Use behind a feature gate or a wrapper you own. Will
  promote to `stable` or be removed before 2.0.
- **`internal`** — Exported because Bun's source-conditioned exports
  expose every file in `src/`. We treat these names as private to the
  package; they may rename or vanish on any release. If you import
  one, you own the migration.

## How to read this doc

Each package section lists every export at the symbol level. If a
symbol isn't listed, treat it as `internal`. The plan is to enforce
this in CI before 1.0 with a separate `index.public.ts` that the
package's `exports` field points at.

---

## `@konfig.ts/core`

| Export | Tier | Notes |
|---|---|---|
| `Manifest`, `Manifest.make`, `Manifest.combine`, `Manifest.concat`, `Manifest.whenever`, `Manifest.embedYaml` | stable | The carrier and its constructors. |
| `Manifest.RenderServices`, `Manifest.MakeRun`, `Manifest.EmbedYamlSource`, `Manifest.RawYaml` | stable | Types consumers reference. |
| `RenderContext`, `RenderContext.make`, `RenderContext.makeFull` | stable | Plus the type with `env`, `cluster?`, `k8sVersion?`, `flags?`. |
| `render` | stable | The entrypoint to render a `Manifest<A>`. |
| `Helm` (`Helm.release`, `Helm.HelmReleaseOptions`) | stable | Digest verification is part of the contract. |
| `Dep` (every `Dep.*` constructor + `Provide<K, N>` and `Need<K, N>` types) | stable | The dep-graph kinds. |
| `SecretRef`, `ConfigMapRef`, `ServiceAccountRef`, `PvcRef`, `SecretRefName`, `ConfigMapRefName`, `PvcRefName` | stable | Branded ref types. |
| `boundary` | stable | Schema decode wrapper. |
| `Yaml.serialize`, `Yaml.filenameFor` | stable | Stable YAML output rules. |
| `diffFiles`, `formatDiff`, `hasDifferences`, `parseYaml`, `parseYamlAll`, `redact`, `deepEqual` | stable | Structural diff and helpers. |
| `DiffFormat`, `DiffResult`, `FileDiff`, `DocDiff`, `RedactOptions` | stable | Types. |
| `RenderError`, `EmbedYamlReadError`, `BoundaryDecodeError`, `HelmVersionTooLow`, `HelmRenderError`, `HelmDigestMismatch`, `CrdExtractError`, `AnyRenderError` | stable | Tagged error union. |
| `KonfigConfig`, `decodeKonfigConfigSync`, `decodeKonfigConfigEffect`, `ClusterSpec`, `EnvEntry`, `OutDir`, `HelmConfig`, `CrdConfig`, `DiffConfig`, `ServicesConfig`, `ResolvedKonfigConfig` | stable | Top-level config schema. |
| `EnvImages`, `ImagesConfig`, `decodeImagesSync`, `decodeImagesEffect`, `lookupEnv`, `lookupEnvEffect`, `imagesFor`, `requireImage`, `ImagesAppMissing`, `ImagesEnvMissing` | stable | Per-env image overrides. |
| `unsafeCoerce`, `brand` | stable | Type-erasure escape hatches with documented reasons. |
| `coerce` (deprecated) | experimental | Aliased to `unsafeCoerce`; will be removed in 1.0.0. |

## `@konfig.ts/k8s`

| Export | Tier | Notes |
|---|---|---|
| `K8s` namespace (`Container`, `Deployment`, `Secret`, etc.) | stable | Re-exported from pinned `kubernetes-types`. |
| `Workload.web`, `Workload.cron`, `ReloaderOption` | stable | High-level workload helpers. |
| `Deployment`, `StatefulSet`, `Job`, `CronJob` (and their `Input`/`Manifest` types) | stable | Workload-tier constructors. |
| `Service`, `Ingress`, `ingressTLS` (and their `Input` types) | stable | Network-tier. |
| `Namespace`, `ServiceAccount`, `ConfigMap`, `Secret`, `_SecretIdentity` | stable | Identity-tier constructors expose `.ref`. |
| `PersistentVolume`, `PersistentVolumeClaim`, `NetworkPolicy`, `ClusterRole`, `ClusterRoleBinding`, `Role`, `RoleBinding` | stable | Policy-tier. |
| `secretEnv`, `configMapEnv`, `valueEnv`, `rawEnv`, `EnvVar`, `EnvVarSource` | stable | Env helpers. |
| `volumeFromSecret`, `volumeFromConfigMap`, `emptyDirVolume`, `pvcVolume`, `Volume` | stable | Volume helpers. |
| `ContainerInput`, `PodSpecInput`, `imagePullSecret` | stable | Extend `K8s.Container` / `K8s.PodSpec` with brand overrides. |
| `SecretBackend<N, K, RequiresSource>`, `BackendEmitInput`, `BackendTag`, `BackendSourceMissing` | stable | Backend contract. |
| `Environment.bind`, `Environment.runtime`, `bindEnvironment`, all `Bind*Input` / `Declared*` types | stable | Env contract emission + runtime. |
| `Secret.bind`, `bindSecret`, `BindSecretInput`, `DeclaredSecret` | stable | Single-secret binding. |
| `NativeSecret.backend` | stable | Plaintext Secret backend (with `silenceWarning` opt-in). |
| `hashSecretValues`, `hashAllSecretValues`, `podHash`, `PodHashError` | stable | Build-time pod-restart-on-rotation. |

## `@konfig.ts/env`

| Export | Tier | Notes |
|---|---|---|
| `defineSecret`, `defineLiteral`, `defineDownward`, `defineEnvironment` | stable | The four atom constructors. |
| `runtime` (re-exported as `Environment.runtime`) | stable | Bundle → runtime decode. |
| `environmentLayer`, `EnvironmentShape` | stable | Layer wrapper. |
| `Environment<M>`, `EnvMember`, `MemberValue<A>`, `AnyEnvironment` | stable | Bundle types. |
| `SecretEntry`, `LiteralEntry`, `DownwardEntry`, `AnySecretEntry`, `AnyLiteralEntry`, `AnyDownwardEntry`, `DefineSecretInput`, `DefineLiteralInput`, `DefineDownwardInput` | stable | Atom types. |
| `SecretSource`, `SecretSourceError`, `FromCommandInput`, `FromCommandSpec`, `FromConfigInput`, `LiteralInput`, `ResolvedSecretValues` | stable | Source primitives. |
| `EnvNameCollision`, `EnvClaim`, `EntryKind`, `EntryMarker`, `HasEnvClaims` | stable | Collision and marker types. |

## `@konfig.ts/sops`

| Export | Tier | Notes |
|---|---|---|
| `Sops.source`, `Sops.backend`, `Sops.passthrough` | stable | Three modes. |
| `SopsBackendOptions`, `SopsSourceInput` | stable | Options. |
| `SopsRecipients`, `SopsSecret`, `SopsSecretSpec`, `SopsSecretTemplate` | stable | CR types. |
| `SopsInvocationError` | stable | Process error. |
| `sopsDecrypt`, `sopsExtract`, `sopsEncryptStdin`, `SopsDecryptInput`, `SopsExtractInput`, `SopsEncryptStdinInput` | experimental | Low-level shell-out helpers. |

## `@konfig.ts/sealed-secrets`

| Export | Tier | Notes |
|---|---|---|
| `SealedSecrets.backend`, `SealedSecretsBackendOptions` | stable | Single entrypoint. |
| `SealedSecret`, `SealedSecretSpec`, `SealedSecretScope`, `SealedSecretTemplate` | stable | CR types. |
| `KubesealCertMissing`, `KubesealInvocationError`, `KubesealParseError`, `runKubeseal`, `RunKubesealInput`, `resolveCertPath` | experimental | Low-level kubeseal helpers. |

## `@konfig.ts/external-secrets`

| Export | Tier | Notes |
|---|---|---|
| `ExternalSecrets.backend`, `ExternalSecretsBackendOptions` | stable | Single entrypoint. |
| `ExternalSecret`, `ExternalSecretSpec`, `ExternalSecretTarget`, `ExternalSecretRemoteRef`, `ExternalSecretDataEntry`, `SecretStoreKind`, `SecretStoreRef`, `ExternalSecretCreationPolicy`, `ExternalSecretDeletionPolicy` | stable | CR types. |

## `@konfig.ts/argocd`

| Export | Tier | Notes |
|---|---|---|
| `Application.define`, `Application.make`, `Application.LiteralName` | stable | Core API. |
| `Application` (the type), `ApplicationDefineOptions`, `ApplicationHandle`, `ApplicationMakeOptions`, `ArgoSource`, `SyncPolicy`, `BuildMetadata` | stable | Types. |
| `AppOfApps.make`, `AppOfApps.entrypoint`, `AppOfAppsResult` | stable | Top-level composition. |
| `Module.fixedNs`, `Module.dynamicNs`, `FixedNsModuleConfig`, `DynamicNsModuleConfig`, `ModuleBuildContext`, `ModuleBuildResult` | stable | Module factories. |
| `SyncWave`, `Hook`, `SyncOptions` | stable | Annotation helpers. |
| `serializeApplicationCR`, `applicationCRFilename` | stable | YAML emission. |

## `@konfig.ts/docker`

| Export | Tier | Notes |
|---|---|---|
| `DockerSpec`, every `*Atom` schema | stable | Spec source of truth. |
| `emit`, `EmitInput`, `EmittedDockerfiles` | stable | Generate Dockerfiles. |
| `lower` | experimental | IR lowering, may move. |
| `WorkspaceGraph` (`findRoot`, `allWorkspaces`, `closureOf`, `detectPm`, `RootDir`, `Workspace`, `DetectedPm`, `DetectedPmKind`, `YarnVariant`, `PackageJson`) | stable | The graph API. |
| Dockerfile IR types | experimental | Subject to refactor as the IR settles. |
| PM modules (`bun`, `npm`, `pnpm`, `yarn`) | internal | Use the spec atoms; the modules will likely consolidate. |

## `@konfig.ts/cli`

The CLI binary is the contract — its `--help` output is what users
program against. Programmatic consumption of CLI internals is
`internal`.

## Changelog policy

Follow [Keep a Changelog](https://keepachangelog.com). Squash all
0.0.x experimentation into a single "Initial release" entry on
1.0.0. From 1.0.0 onwards every release gets:

- `### Added` — new exports / features.
- `### Changed` — behavior changes (with migration notes if
  user-visible).
- `### Deprecated` — exports flagged for removal in the next major.
- `### Removed` — exports gone. Only on majors.
- `### Fixed` — bug fixes that don't change documented behavior.
- `### Security` — sec-relevant changes (with CVE references where
  applicable).
