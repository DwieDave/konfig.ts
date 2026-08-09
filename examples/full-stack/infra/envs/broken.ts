// Demonstrates: missing dep-graph provider is caught at compile time (see @ts-expect-error below).
import { AppOfApps } from "@konfig.ts/argocd"
import { cluster } from "../cluster"
import { defineApi } from "../modules/api"
import { defineWorker } from "../modules/worker"

const branch = "main"
const rootPath = "./infra/k8s/manifests/broken"
const src = (name: string) => ({
  repoURL: cluster.repositoryUrl,
  targetRevision: branch,
  path: `${rootPath}/${name}`
})

const api = defineApi({
  name: "api",
  source: src("api"),
  replicas: 1,
  sopsBase: "infra/secrets"
})
const worker = defineWorker({
  name: "worker",
  source: src("worker"),
  replicas: 1,
  sopsBase: "infra/secrets"
})

export default AppOfApps.entrypoint(
  // @ts-expect-error - _konfig_unsatisfied hint: missing providers for Secret "ghcr-pull" and Image "api" / "worker".
  AppOfApps.fromModules({
    target: { repoURL: cluster.repositoryUrl, branch, rootPath },
    defaults: {},
    modules: [api, worker]
  })
)
