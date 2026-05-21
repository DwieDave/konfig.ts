# @konfig.ts/env

Yieldable environment entries — the shared definition layer between
konfig manifest emission and the pod's runtime Effect application.

## Why

A pod's environment variables live in two places today:

- The konfig manifest (`secretEnv({ name: "DATABASE_URL", ... })`,
  `valueEnv`, `configMapEnv`).
- The pod's runtime code (`Config.redacted("DATABASE_URL")`).

The env-var name `"DATABASE_URL"` is duplicated. This package collapses
both ends into one declaration:

```ts
// shared/secrets.ts — imported by both sides
import { defineSecret, defineEnvironment, defineLiteral } from "@konfig.ts/env";

export const dbCreds = defineSecret({
  name: "db-creds",
  namespace: "prod",
  env: {
    url: "DATABASE_URL",
    password: "DATABASE_PASSWORD",
  },
});

export const port = defineLiteral({ envName: "PORT", value: 8080 });

export const apiEnv = defineEnvironment({ db: dbCreds, port });
```

## Entries and environments

Every `defineSecret` / `defineLiteral` / `defineDownward` call returns
an **entry** — a yieldable Effect `Config<...>` intersected with the
pure binding metadata (`name`, `namespace`, `env`/`envName`). Each
entry is its own state-management-style atom: pull it standalone, or
group it.

`defineEnvironment({...})` is a **bundle** — also a yieldable Config,
with `.members` re-exposing each named entry.

```ts
// runtime pod code
import { Effect, Redacted } from "effect";
import { dbCreds, apiEnv } from "./secrets";

const program = Effect.gen(function* () {
  const env = yield* apiEnv;          // { db: { url: Redacted, password: Redacted }, port: number }
  const db  = yield* dbCreds;          // { url: Redacted, password: Redacted }
  const url = yield* dbCreds.fields.url; // Redacted<string>
});
```

## Bound on the konfig side

`@konfig.ts/k8s` provides `Secret.bind({secret})` and
`Environment.bind({env})` for the manifest-side wiring. They consume
the same shared entries and produce ready-to-spread `envVars` for the
container:

```ts
// konfig-side infra code
import { Secret, Environment, Workload } from "@konfig.ts/k8s";

const apiEnvK8s = Environment.bind({ env: apiEnv });

Workload.web({
  /* ... */
  deployment: {
    containers: [{ name: "api", image: "...", env: apiEnvK8s.envVars }],
  },
});
```

## Status

Phase 1 of the secret refactor — see `.docs/secret-refactoring/plan.md`.
Entries, bundles, env-var wiring only. Backends (ExternalSecrets,
SealedSecrets, Sops) and the `source` / `values` accessors land in
later phases.
