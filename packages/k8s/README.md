# @konfig.ts/k8s

Kubernetes resource builders with branded references. Cross-resource links — an
env var to a Secret, a volume to a PVC, Ingress TLS to a Secret — are
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
    ...EnvVar.secretEnv({ ref: apiCreds.ref, map: { DATABASE_URL: "url" }, podNamespace: "prod" }),
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

**Branded refs** — `SecretRef`, `ConfigMapRef`, `PvcRef`.
Identity constructors (`Secret.make`, `ConfigMap.make`, …) expose a typed
`.ref`; the enforcement points (env `secretKeyRef`, volumes, `imagePullSecrets`,
Ingress TLS, reloader lists) take the brand and reject raw strings.

**Env vars** — `EnvVar.value`, `EnvVar.secretEnv` / `EnvVar.configMapEnv` (many vars from one ref), `EnvVar.fromConfigMap`.
Duplicate names in one container's `env` are caught at compile time.

**Ports** — `Port.make({ name, containerPort })` and `Port.ref(name)` brand the
port-name union, so a probe or Service targeting a typo'd port won't compile.

**Workloads** — `Workload.web` (Deployment + Service + optional Ingress) covers
the common shape. The lower-level `Deployment.make`, `Service.fromContainer`, `NetworkPolicy.fromPodSet`
and the identity constructors are there for bespoke resources.

**Env contracts & secrets** — `Environment.bind` and `Secret.bind` turn a
[`@konfig.ts/env`](../env) contract into the Deployment env block plus a secret
backend's CRs ([sops](../sops), [sealed-secrets](../sealed-secrets),
[external-secrets](../external-secrets), or the built-in `NativeSecret`).

**Secret rotation** — `Workload.web({ reloader: "stakater" })` annotates for
[Stakater Reloader](https://github.com/stakater/Reloader) (rolls on in-cluster
change); `hashSecretValues` stamps a pod-spec hash that rolls on re-render.

**Writing a backend** — `Backend.define({ tag, requiresSource, emit })` turns one
declaration into a backend factory `(opts) => backend`; `emit` receives `{ base, opts, label }`.
`Backend.encrypting({ tag, precheck, toPlain, bin, args, schema, schemaLabel, verify? })`
adds the shared plaintext, CLI, decode and verify pipeline. `Backend.plainSecret` and
`Backend.secretMeta` build the plain Secret and metadata.

## Internals

Built on `@konfig.ts/core`'s `Manifest<A>` carrier; refs and `Dep.*` needs
propagate through Effect `Layer`s. Generated Kubernetes types come from
`kubernetes-types@~1.30.0`.

## Requirements

konfig.ts is built on [Effect](https://effect.website/) 4. Any 4.x build from 4.1.0 on
is supported:

- **`effect@^4.1.0`** — peer dependency of every package.
- **`@effect/platform-node@^4.1.0`** — a regular dependency of `@konfig.ts/core`,
  since `renderAllYaml()` and `renderAllYamlEffect()` need its Node filesystem/subprocess
  implementations. It is installed automatically with core.
