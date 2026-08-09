import { AppOfApps } from "@konfig.ts/argocd"
import { cluster } from "../cluster"
import { defineApi } from "../modules/api"
import { defineApiBuild, defineWorkerBuild } from "../modules/builds"
import { defineFeatureFlags } from "../modules/feature-flags"
import { defineImagePulls } from "../modules/image-pulls"
import { definePostgres } from "../modules/postgres"
import { defineRedisCache } from "../modules/redis-cache"
import { defineSopsOperator } from "../modules/sops-operator"
import { defineWorker } from "../modules/worker"

// Modules are listed in dependency order (providers first); see broken.ts for the missing-provider error case.

const branch = "main"
const rootPath = "./infra/k8s/manifests/prod"
const src = (name: string) => ({
  repoURL: cluster.repositoryUrl,
  targetRevision: branch,
  path: `${rootPath}/${name}`
})

const sopsBase = "infra/secrets"

const sopsOperator = defineSopsOperator({
  name: "sops-secrets-operator",
  source: src("sops-operator")
})
const imagePulls = defineImagePulls({
  name: "image-pulls",
  source: src("image-pulls"),
  sopsBase
})
const featureFlags = defineFeatureFlags({
  name: "feature-flags",
  source: src("feature-flags")
})
const postgres = definePostgres({
  name: "postgres",
  source: src("postgres"),
  storageGi: 20
})
const apiBuild = defineApiBuild({
  name: "api-build",
  source: src("api-build"),
  registry: "ghcr.io/example",
  tag: "1.0.0"
})
const workerBuild = defineWorkerBuild({
  name: "worker-build",
  source: src("worker-build"),
  registry: "ghcr.io/example",
  tag: "1.0.0"
})
const api = defineApi({
  name: "api",
  source: src("api"),
  replicas: 2,
  sopsBase
})
const worker = defineWorker({
  name: "worker",
  source: src("worker"),
  replicas: 1,
  sopsBase
})
const redisCache = defineRedisCache({ name: "redis-cache", source: src("redis-cache") })

export default AppOfApps.entrypoint(
  AppOfApps.fromModules({
    target: { repoURL: cluster.repositoryUrl, branch, rootPath },
    defaults: { destination: { server: "https://kubernetes.default.svc" } },
    modules: [
      sopsOperator,
      imagePulls,
      featureFlags,
      postgres,
      apiBuild,
      workerBuild,
      redisCache,
      api,
      worker
    ]
  })
)
