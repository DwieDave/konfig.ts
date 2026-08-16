import { workerEnv } from "@example/env-contracts"
import { Application } from "@konfig.ts/argocd"
import { Dep, type Manifest, Module } from "@konfig.ts/core"
import { Container, Deployment, Environment } from "@konfig.ts/k8s"
import { Sops } from "@konfig.ts/sops"
import { Effect } from "effect"

export interface WorkerOpts {
  readonly replicas: number
  readonly sopsBase: string
}

// konfig: WHY reuses the db-creds contract; api and worker each emit an identical SopsSecret into their own Application directory (konfig does not dedupe across Applications)
export const defineWorker = Module.fixedNs({
  target: Application.target,
  namespace: "app",
  build: ({ name, namespace }, opts: WorkerOpts) =>
    Effect.gen(function*() {
      const ghcrRef = yield* Dep.Secret("ghcr-pull")
      const workerImage = yield* Dep.Image("worker")

      const bound = Environment.bind({
        env: workerEnv,
        namespace,
        secrets: {
          db: {
            backend: Sops.passthrough({
              file: `${opts.sopsBase}/SopsSecret-db-creds.yaml`
            })
          }
        }
      })

      const workerContainer = Container.define({
        name,
        image: workerImage,
        ports: [],
        env: bound.envVars
      })

      const deployment = Deployment.make({
        name,
        namespace,
        replicas: opts.replicas,
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: { app: name } },
          spec: {
            imagePullSecrets: [{ name: ghcrRef }],
            containers: [workerContainer]
          }
        }
      })

      const out: ReadonlyArray<Manifest.Manifest<unknown>> = [
        ...bound.manifests,
        deployment
      ]
      return out
    })
})
