# @konfig.ts/k8s

Kubernetes resource builders with branded references. Cross-resource links — an
env var to a Secret, a volume to a ConfigMap, Ingress TLS to a Secret — are
checked at the type level, so a workload pointing at a Secret nobody creates is
a compile error, not a failed `argocd sync`.

## Install

```bash
bun add @konfig.ts/k8s
```

## Usage

Compose a container and a web workload (Deployment + Service, plus an Ingress
if you add one):

```ts
import { Container, EnvVar, Port, Secret, Workload } from "@konfig.ts/k8s"

const apiCreds = Secret.make({
  name: "api-creds",
  namespace: "prod",
  stringData: { url: "postgres://…" }
}) // apiCreds.ref is a SecretRef<"api-creds">

const api = Container.define({
  name: "api",
  image: "ghcr.io/example/api:1.0.0",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  env: [
    // ref is branded — a raw string, or a Secret in the wrong namespace, won't compile
    EnvVar.fromSecretForPod({ name: "DATABASE_URL", ref: apiCreds.ref, key: "url", podNamespace: "prod" }),
    EnvVar.value({ name: "LOG_LEVEL", value: "info" })
  ],
  readinessProbe: { httpGet: { path: "/healthz", port: Port.ref("http") } }
})

const workload = Workload.web({
  name: "api",
  namespace: "prod",
  deployment: { replicas: 2, containers: [api] },
  service: { ports: [{ port: 80, targetPort: Port.ref("http") }] }
})
```

## What's inside

**Branded refs** — `SecretRef`, `ConfigMapRef`, `ServiceAccountRef`, `PvcRef`.
Identity constructors (`Secret.make`, `ConfigMap.make`, …) expose a typed
`.ref`; the enforcement points (env `secretKeyRef`, volumes, `imagePullSecrets`,
Ingress TLS) take the brand and reject raw strings.

**Env vars** — `EnvVar.value`, `EnvVar.fromSecretForPod`, `EnvVar.fromConfigMap`.
Duplicate names in one container's `env` are caught at compile time.

**Ports** — `Port.make({ name, containerPort })` and `Port.ref(name)` brand the
port-name union, so a probe or Service targeting a typo'd port won't compile.

**Workloads** — `Workload.web` (Deployment + Service + optional Ingress) and
`Workload.cron` (CronJob + private ServiceAccount) cover the common shapes. The
lower-level `Deployment` / `StatefulSet` / `Job` / `CronJob` / `Service` /
`Ingress` and the identity / RBAC / policy constructors are there for bespoke
resources.

**Env contracts & secrets** — `Environment.bind` and `Secret.bind` turn a
[`@konfig.ts/env`](../env) contract into the Deployment env block plus a secret
backend's CRs ([sops](../sops), [sealed-secrets](../sealed-secrets),
[external-secrets](../external-secrets), or the built-in `NativeSecret`).

**Secret rotation** — `Workload.web({ reloader: "stakater" })` annotates for
[Stakater Reloader](https://github.com/stakater/Reloader) (rolls on in-cluster
change); `hashSecretValues` stamps a pod-spec hash that rolls on re-render.

## Internals

Built on `@konfig.ts/core`'s `Manifest<A>` carrier; refs and `Dep.*` needs
propagate through Effect `Layer`s. Raw Kubernetes types are re-exported as the
`K8s` namespace (pinned `kubernetes-types@1.30.0`). See
[`.docs/architecture.md`](../../.docs/architecture.md).

## Requirements

konfig.ts is built on [Effect](https://effect.website/), currently in beta.
Until Effect ships a stable 4.x, install the exact beta konfig.ts is built
against:

- **`effect@4.0.0-beta.70`** — required by every package.
- **`@effect/platform-node@4.0.0-beta.70`** — required only when you call
  `render()` (the Node filesystem/subprocess entrypoint); manifest-only
  consumers can omit it (it is declared as an optional peer).

The pin is exact on purpose: Effect's beta line makes breaking changes between
builds, so a looser range surfaces as `ERESOLVE` install conflicts. It relaxes
to a caret range once Effect reaches a stable 4.x.
