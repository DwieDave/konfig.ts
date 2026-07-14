import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { RenderContext, Yaml } from "@konfig.ts/core"
import { EnvVar, Secret, Workload } from "@konfig.ts/k8s"
import { Effect } from "effect"

const dbCreds = Secret.make({
  name: "db-creds",
  namespace: "prod",
  stringData: { url: "postgres://api@db.prod/api" }
})

const api = Workload.web({
  name: "api",
  namespace: "prod",
  deployment: {
    replicas: 2,
    containers: [
      {
        name: "api",
        image: "ghcr.io/example/api:1.0",
        ports: [{ containerPort: 8080 }],
        env: [
          EnvVar.value({ name: "PORT", value: "8080" }),
          EnvVar.fromSecret({ name: "DATABASE_URL", ref: dbCreds.ref, key: "url" })
        ]
      }
    ]
  },
  service: { ports: [{ port: 80, targetPort: 8080 }] }
})

// @ts-expect-error  raw string is not a SecretRef — rejected at signature
EnvVar.fromSecret({ name: "FOO", ref: "db-creds", key: "url" })

// @ts-expect-error  names are in the type — a ref to "other" can't be
const _wrong: typeof dbCreds.ref = Secret.make({
  name: "other",
  namespace: "prod",
  stringData: {}
}).ref

// @ts-expect-error  keys are in the type — only "url" was declared on dbCreds
EnvVar.fromSecret({ name: "DATABASE_PASSWORD", ref: dbCreds.ref, key: "passowrd" })

const program = Effect.gen(function*() {
  const ctx = RenderContext.make("prod")
  const secret = yield* dbCreds.render(ctx)
  const [deployment, service] = yield* api.render(ctx)
  for (const r of [secret, deployment, service]) {
    yield* Effect.log(`${Yaml.serialize({ value: r })}---`)
  }
})

NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
