import { apiEnv } from "@example/env-contracts"
import { Application } from "@konfig.ts/argocd"
import { Dep } from "@konfig.ts/core"
import { Container, Environment, EnvVar, Port, Workload } from "@konfig.ts/k8s"
import { Sops } from "@konfig.ts/sops"
import { Effect } from "effect"
import { featureFlags } from "./feature-flags"

export interface ApiOpts {
  readonly replicas: number
  readonly sopsBase: string
}

// `apps/api` workload. `Dep.Image("api")` resolves via `defineApiBuild`;
// `EnvVar.secretEnv` with `podNamespace` enforces the namespace match at type-check time.
export const defineApi = Application.module({
  namespace: "app",
  build: ({ name, namespace }, opts: ApiOpts) =>
    Effect.gen(function*() {
      const ghcrRef = yield* Dep.Secret("ghcr-pull")
      const apiImage = yield* Dep.Image("api")

      const bound = Environment.bind({
        env: apiEnv,
        namespace,
        secrets: {
          db: Sops.passthrough({ file: `${opts.sopsBase}/SopsSecret-db-creds.yaml` }),
          s3: Sops.passthrough({ file: `${opts.sopsBase}/SopsSecret-s3-creds.yaml` }),
          jwt: Sops.passthrough({ file: `${opts.sopsBase}/SopsSecret-jwt-signing-key.yaml` })
        }
      })

      const apiContainer = Container.define({
        name,
        image: apiImage,
        ports: [Port.make({ name: "http", containerPort: 8080 })],
        env: [
          ...bound.envVars,
          ...EnvVar.secretEnv(bound.members.db.ref, { DATABASE_URL_PRIMARY: "url" }, { podNamespace: namespace }),
          ...EnvVar.configMapEnv(featureFlags.ref, { FEATURE_NEW_UI: "NEW_UI" }),
          EnvVar.value({ name: "API_NAME", value: name })
        ],
        readinessProbe: {
          httpGet: { path: "/healthz", port: Port.ref("http") },
          periodSeconds: 5
        }
      })

      const workload = Workload.web({
        name,
        namespace,
        deployment: {
          replicas: opts.replicas,
          imagePullSecrets: [{ name: ghcrRef }],
          containers: [apiContainer]
        },
        service: {
          ports: [{ port: 80, targetPort: Port.ref("http") }]
        }
      })

      return [...bound.manifests, workload]
    })
})
