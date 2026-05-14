# @konfig.ts/k8s

Kubernetes resource constructors with branded references. Built on
`@konfig.ts/core`'s `Manifest<A, R, P>` algebra. Branded refs enforce
cross-resource invariants at the type level — the place `@tsk` pays
the most rent.

## Branded references

```ts
import { SecretRef, ConfigMapRef, ServiceAccountRef } from "@konfig.ts/k8s";

const apiCreds = SecretRef.of("api-creds");           // SecretRef<"api-creds">
const cfg      = ConfigMapRef.of("oauth-templates");  // ConfigMapRef<"oauth-templates">
const sa       = ServiceAccountRef.of("api");         // ServiceAccountRef<"api">
```

Each ref carries the resource *name* in its type parameter. The six
FR-4.4 enforcement points (env var secretKeyRef, env var configMapKeyRef,
volume secret, volume configMap, imagePullSecret, Ingress TLS) all
accept the branded type and reject raw strings.

## Identity constructors expose `.ref`

```ts
const apiSecret = Secret.make({ name: "api-creds", namespace: "prod", stringData: {...} });
// apiSecret is a Manifest<Secret, Empty, {Secret: "api-creds"}>
// apiSecret.ref is a SecretRef<"api-creds">
```

The `.ref` accessor means consumers wire the brand through without
restating the name:

```ts
const env = secretEnv("DATABASE_URL", { ref: apiSecret.ref, key: "url" });
// env: EnvVar<{Secret: "api-creds"}>
```

## Env-var helpers

| Helper | Carries | Rejects raw string for |
|---|---|---|
| `valueEnv(name, value)` | Empty | n/a |
| `secretEnv(name, {ref, key, optional?})` | `Single<"Secret", N>` | `ref` |
| `configMapEnv(name, {ref, key, optional?})` | `Single<"ConfigMap", N>` | `ref` |
| `rawEnv({name, value?, valueFrom?})` | Empty | n/a (escape hatch) |

## Volume helpers

| Helper | Carries |
|---|---|
| `volumeFromSecret(name, ref)` | `Single<"Secret", N>` |
| `volumeFromConfigMap(name, ref)` | `Single<"ConfigMap", N>` |
| `emptyDirVolume(name, opts?)` | Empty |
| `pvcVolume(name, claimName, opts?)` | Empty |

## Constructors

Workload-tier (`Deployment.make`, `StatefulSet.make`, `Job.make`,
`CronJob.make`) accept typed `ContainerInput<Env>[]`,
`Volume<R>[]`, `imagePullSecrets: {name: SecretRef<N>}[]`,
`serviceAccountName: ServiceAccountRef | string`. The resulting
Manifest's `R` is the union of every helper's R.

Network-tier (`Service.make`, `Ingress.make`). Ingress TLS uses the
`ingressTLS(secretName, hosts?)` helper for branded refs.

Identity-tier (`Namespace.make`, `ServiceAccount.make`,
`ConfigMap.make`, `Secret.make`) return a `*Manifest<N>` carrying the
typed `.ref`.

Policy-tier (`PersistentVolume.make`, `PersistentVolumeClaim.make`,
`NetworkPolicy.make`, `ClusterRole.make`, `ClusterRoleBinding.make`,
`Role.make`, `RoleBinding.make`) — simple Manifest constructors with
Empty R.

## Higher-level: `Workload.web` and `Workload.cron`

Built for the workload shapes consumers need today — not speculative.

`Workload.web(...)` composes Deployment + Service + (optional) Ingress
with derived labels (`app: <name>`). `Workload.cron(...)` composes
CronJob + ServiceAccount (the SA is private to the cron).

## k8s 1.30 types

Re-exported from `kubernetes-types@1.30.0` under
`src/.generated/k8s-types/`. We don't roll our own OpenAPI codegen:
the package is already pinned at the cluster version and is a
transitive dep of `effect`, so it saves ~5k LOC of committed
artifacts. See `SPIKE.md` for the decision rationale.

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
└── workloadHelpers.ts        Workload.web, Workload.cron
SPIKE.md                      T5.0 spike (typesafe asset mgmt verdict)
```
