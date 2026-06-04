# @konfig.ts/k8s

Kubernetes resource constructors with branded references on top of
`@konfig.ts/core`'s `Manifest<A>` carrier. The brands are where the
package earns its keep: cross-resource invariants (env-var → Secret,
volume → ConfigMap, Ingress TLS → Secret) are checked at the type level,
and the `Dep.*` tracking propagates needs/provides through Effect
`Layer`s.

## Branded references

```ts
import { SecretRef, ConfigMapRef, ServiceAccountRef } from "@konfig.ts/k8s";

const apiCreds = SecretRef.of("api-creds");           // SecretRef<"api-creds">
const cfg      = ConfigMapRef.of("oauth-templates");  // ConfigMapRef<"oauth-templates">
const sa       = ServiceAccountRef.of("api");         // ServiceAccountRef<"api">
```

Each ref carries the resource *name* in its type parameter. The
enforcement points (env var `secretKeyRef` / `configMapKeyRef`, volume
secret, volume configMap, `imagePullSecret`, Ingress TLS) all accept the
branded type and reject raw strings.

## Identity constructors expose `.ref`

```ts
const apiSecret = Secret.make({ name: "api-creds", namespace: "prod", stringData: {...} });
// apiSecret.ref is a SecretRef<"api-creds">
```

The `.ref` accessor means consumers wire the brand through without
restating the name:

```ts
const env = secretEnv("DATABASE_URL", { ref: apiSecret.ref, key: "url" });
```

## Env-var helpers

| Helper | Rejects raw string for |
|---|---|
| `valueEnv(name, value)` | n/a |
| `secretEnv(name, {ref, key, optional?})` | `ref` |
| `configMapEnv(name, {ref, key, optional?})` | `ref` |
| `rawEnv({name, value?, valueFrom?})` | n/a (escape hatch) |

## Volume helpers

| Helper |
|---|
| `volumeFromSecret(name, ref)` |
| `volumeFromConfigMap(name, ref)` |
| `emptyDirVolume(name, opts?)` |
| `pvcVolume(name, claimName, opts?)` |

## Constructors

Workload-tier (`Deployment.make`, `StatefulSet.make`, `Job.make`,
`CronJob.make`) accept typed containers, `Volume`s,
`imagePullSecrets: { name: SecretRef<N> }[]`, and
`serviceAccountName: ServiceAccountRef | string`.

Network-tier (`Service.make`, `Ingress.make`). Ingress TLS uses the
`ingressTLS(secretName, hosts?)` helper for branded refs.

Identity-tier (`Namespace.make`, `ServiceAccount.make`, `ConfigMap.make`,
`Secret.make`) return constructors whose returned record carries the
typed `.ref`.

Policy-tier (`PersistentVolume.make`, `PersistentVolumeClaim.make`,
`NetworkPolicy.make`, `ClusterRole.make`, `ClusterRoleBinding.make`,
`Role.make`, `RoleBinding.make`) — simple constructors with no extra
dependencies.

## Higher-level: `Workload.web` and `Workload.cron`

Built for the workload shapes consumers need today — not speculative.

`Workload.web(...)` composes Deployment + Service + (optional) Ingress
with derived labels (`app: <name>`). `Workload.cron(...)` composes
CronJob + ServiceAccount (the SA is private to the cron).

## Secret backends — `SecretBackend<N, K>`

`SecretBackend` is the contract Sops / SealedSecrets / ExternalSecrets
implement. `Secret.bind({ secret, backend, source? })` ties an env-bundle
secret to a backend emission. `backend.requiresSource` is `true` for
Sops and SealedSecrets (they need plaintext at render time) and `false`
for ExternalSecrets (it just emits an `ExternalSecret` CR pointing at a
remote store).

## k8s 1.30 types

Re-exported from `kubernetes-types@1.30.0` under
`src/.generated/k8s-types/`. We pin to the cluster minor and ship the
re-export rather than rolling our own OpenAPI codegen.

## Layout

```
src/
├── index.ts                  barrel
├── .generated/k8s-types/     thin re-export from kubernetes-types
├── refs.ts                   SecretRef, ConfigMapRef, ServiceAccountRef
├── env.ts                    secretEnv, configMapEnv, valueEnv, rawEnv
├── volume.ts                 volumeFromSecret, volumeFromConfigMap, ...
├── container.ts              ContainerInput, PodSpecInput, imagePullSecret
├── identity.ts               Namespace, ServiceAccount, ConfigMap, Secret
├── workload.ts               Deployment, StatefulSet, Job, CronJob
├── network.ts                Service, Ingress, ingressTLS
├── policy.ts                 PV, PVC, NetworkPolicy, RBAC
├── workloadHelpers.ts        Workload.web, Workload.cron
└── backend.ts                SecretBackend contract + Secret.bind
```
