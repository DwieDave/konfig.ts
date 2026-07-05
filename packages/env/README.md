# @konfig.ts/env

One declaration for a pod's environment, shared by both sides of the wire: the
Kubernetes manifest that injects the env vars, and the app code that decodes
them at startup. Name `DATABASE_URL` once — rename it in one place and the
typechecker flags every consumer.

## Install

```bash
bun add @konfig.ts/env
```

## Usage

Declare the contract once, in a module both sides import:

```ts
import { Downward, Environment, Literal, Secret } from "@konfig.ts/env"

export const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

export const apiEnv = Environment.define({
  db: dbCreds,
  http: Environment.define({
    port: Literal.define({ envName: "HTTP_PORT", value: 8080 }),
    logLevel: Literal.define({ envName: "LOG_LEVEL", value: "info" })
  }),
  runtime: Environment.define({
    nodeEnv: Literal.define({ envName: "NODE_ENV", value: "production" }),
    podName: Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" })
  })
})
```

Then use the same `apiEnv` from both sides. `bind` (manifest) and `runtime`
(process) both live in `@konfig.ts/k8s`:

```ts
// infra module — emit the Deployment env block + the secret backend's CRs
import { Environment } from "@konfig.ts/k8s"
const bound = Environment.bind({ env: apiEnv, namespace: "prod", secrets: { db: { backend } } })
// bound.envVars → container env;  bound.manifests → the CRs

// app process — decode the same vars at startup, into a typed record
import { Environment } from "@konfig.ts/k8s"
import { Effect } from "effect"
const config = await Effect.runPromise(Environment.runtime(apiEnv))
console.log(`listening on :${config.http.port}`)
```

## Atoms

| Constructor          | Produces                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| `Secret.define`      | a secret contract (`{ name, namespace, env }`), bound to a backend at compose time |
| `Literal.define`     | a constant (`{ envName, value, schema? }`) baked into the manifest                 |
| `Downward.define`    | a Kubernetes downward-API field (`{ envName, fieldPath }`)                         |
| `Environment.define` | a bundle of the above — nestable; the single source of truth for both sides        |
| `SecretSource`       | plaintext sources for backends: `.fromConfig`, `.literal`, `.fromCommand`          |

Two members claiming the same `envName` is a compile-time error
(`EnvNameCollision`) — caught before it can silently shadow another.

## Internals

An atom is a yieldable Effect `Config` intersected with its binding metadata; a
bundle is a `Config` over the whole tree. See the `Environment` section of
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
