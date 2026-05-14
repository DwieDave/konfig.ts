# @konfig.ts/argocd

Typed ArgoCD `Application` aggregation with compile-time dependency verification.

Builds on `@konfig.ts/core`'s `Manifest<A, R, P>` algebra. Each `Application.make(...)` call aggregates the R/P from its manifest list; `AppOfApps.make({...})` verifies at compile time that the union of all children's P covers every child's R.

## Surface

### `Application<R, P>` + `Application.make`

```ts
import { Application, AppOfApps, SyncWave } from "@konfig.ts/argocd";

const sops = Application.make({
  name: "sops-secrets-operator",
  namespace: "argocd",
  manifests: [helmRelease, namespace],   // Manifest<...>[] — R/P aggregated automatically
  source: {
    repoURL: "ssh://git@github.com/example/infra.git",
    targetRevision: "main",
    path: "./infra/k8s/manifests/prod/sops-secrets-operator",
  },
  syncPolicy: { automated: { prune: false, selfHeal: false } },
  annotations: SyncWave(-1),             // spread any annotation object here
});
```

`Application.make` infers `R` and `P` from the tuple of manifests — no manual annotation needed.

### `AppOfApps.make`

```ts
const prod = AppOfApps.make({
  target: {
    repoURL: "ssh://git@github.com/example/infra.git",
    branch: "main",
    rootPath: "./infra/k8s/manifests/prod",
  },
  defaults: { destination: { server: "https://kubernetes.default.svc" } },
  apps: [sops, certManager, web],
});
```

Return type: `AppOfAppsResult`.

The cross-app dependency check fires **at the call site itself**: `AppOfApps.make`'s opts param is intersected with an internal `AssertSatisfied<Apps>` constraint. When every child's R is covered by some sibling's P that constraint collapses to `unknown` and the opts pass through unchanged. When unsatisfied, the constraint demands a `_ERROR_unsatisfied_dependencies: RequiredDep<...>` property the caller can't reasonably supply — so the call errors with `"Property '_ERROR_unsatisfied_dependencies' is missing"` and the error message names the missing kind+name (e.g. `RequiredDep<"Application", "cert-manager">`). No user-side `satisfies` assertion needed.

### Sync helpers

```ts
import { SyncWave, Hook, SyncOptions } from "@konfig.ts/argocd";

SyncWave(-1)           // → { "argocd.argoproj.io/sync-wave": "-1" }
Hook("PreSync")        // → { "argocd.argoproj.io/hook": "PreSync" }
SyncOptions(["CreateNamespace=true"])  // → { "argocd.argoproj.io/sync-options": "..." }
```

Spread any of these into `Application.make`'s `annotations` field.

### CR emission

```ts
import { serializeApplicationCR, applicationCRFilename } from "@konfig.ts/argocd";

const yaml = serializeApplicationCR(app, target, defaults);
// → YAML string matching nixidy's Application-<name>.yaml shape exactly

const filename = applicationCRFilename(app);
// → "Application-<name>.yaml"
```

`emitApplicationCR(app, target, defaults)` wraps the same YAML in a `Manifest<string, Empty, Single<"Application", Name>>` for use in the M4 build pipeline.

## Types

| Export | Description |
|---|---|
| `Application<R, P>` | The typed Application node |
| `Application.make(opts)` | Aggregate R/P from manifests |
| `AppOfApps.make(opts)` | Verify dep graph at the call site; return `AppOfAppsResult` |
| `AppOfAppsResult` | Runtime shape passed to the renderer |
| `MissingDeps<Apps>` | Type-level union of `RequiredDep` tags not covered by siblings (`never` when satisfied) |
| `RequiredDep<K, N>` | A single missing dep — kind+name pair surfaced in error messages |
| `SyncWave(n)` | Annotation helper |
| `Hook(phase)` | Annotation helper |
| `SyncOptions(opts)` | Annotation helper |
| `serializeApplicationCR(app, target, defaults)` | Emit YAML string |
| `applicationCRFilename(app)` | `Application-<name>.yaml` |
| `emitApplicationCR(app, target, defaults)` | Emit as `Manifest<string, Empty, Single<"Application", Name>>` |

## Status

M3 of the `konfig-typesafe-k8s` workflow. The M4 CLI writer pipes `serializeApplicationCR` output to `apps/Application-<name>.yaml`. The M5 k8s primitives feed into `Application.make`'s `manifests` array.
