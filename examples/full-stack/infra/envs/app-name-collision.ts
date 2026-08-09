// Demonstrates: two Applications sharing a name are rejected at compile time.
import { Application, AppOfApps } from "@konfig.ts/argocd"
import { cluster } from "../cluster"

const src = (name: string) => ({
  repoURL: cluster.repositoryUrl,
  targetRevision: "main",
  path: `./infra/k8s/manifests/collision/${name}`
})

const apiV1 = Application.define({
  name: "api",
  namespace: "app",
  source: src("api"),
  build: () => []
})

const apiV2 = Application.define({
  name: "api",
  namespace: "app",
  source: src("api"),
  build: () => []
})

// @ts-expect-error — duplicate App "api": the later module would silently shadow the earlier.
const collision = AppOfApps.fromModules({
  target: { repoURL: cluster.repositoryUrl, branch: "main", rootPath: "./out" },
  defaults: {},
  modules: [apiV1, apiV2] as const
})

export default AppOfApps.entrypoint(collision)
