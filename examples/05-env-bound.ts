import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { renderAllYamlEffect, RenderContext } from "@konfig.ts/core"
import { Literal, Secret, SecretSource } from "@konfig.ts/env"
import { Environment, NativeSecret, Workload } from "@konfig.ts/k8s"
import { Effect } from "effect"

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const port = Literal.define({ envName: "PORT", value: 8080 })

const apiEnv = Environment.define({ db: dbCreds, port })

const apiEnvK8s = Environment.bind({
  env: apiEnv,
  secrets: {
    db: {
      backend: NativeSecret.backend({ silenceWarning: true }),
      source: SecretSource.literal({
        data: { url: "postgres://localhost/api", password: "hunter2" }
      })
    }
  }
})

const api = Workload.web({
  name: "api",
  namespace: "prod",
  deployment: {
    containers: [
      {
        name: "api",
        image: "ghcr.io/example/api:1.0",
        ports: [{ containerPort: 8080 }],
        env: apiEnvK8s.envVars
      }
    ]
  },
  service: { ports: [{ port: 80, targetPort: 8080 }] }
})

const program = Effect.gen(function*() {
  const ctx = RenderContext.make("prod")
  yield* Effect.log("=== Secret manifests (from Environment.bind) ===")
  yield* Effect.log(yield* renderAllYamlEffect({ ctx, manifests: apiEnvK8s.manifests }))
  yield* Effect.log("=== Workload manifests ===")
  yield* Effect.log(yield* renderAllYamlEffect({ ctx, manifests: [api] }))
})

NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
