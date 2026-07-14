/**
 * Regression test: two Applications sharing a name are rejected at
 * compile time.
 *
 * `Application.define({ name: "api", ... })` produces
 * `Dep.Provide<"App", "api">`. At runtime, folding two such layers via
 * `Compose.composeLayers` is structurally allowed — Effect's Layer
 * system accepts redundant providers and the second definition would
 * silently shadow the first. `Compose.DuplicateProvides` closes that
 * hole: `AppOfApps.fromModules` folds over the modules *tuple* (where
 * each element's Out channel is still individually addressable, unlike
 * the erased union) and rejects any overlap in unique Provide kinds
 * with a `_konfig_duplicate` hint. The `@ts-expect-error` below fails
 * the build if the check ever regresses.
 *
 * Not registered in konfig.json — compile-time regression test only.
 */
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

// Both handles claim `App<"api">` — the duplicate-provide check makes
// this call fail to typecheck with a `_konfig_duplicate` hint naming
// the colliding app.
// @ts-expect-error — duplicate App "api": the later module would silently shadow the earlier.
const collision = AppOfApps.fromModules({
  target: { repoURL: cluster.repositoryUrl, branch: "main", rootPath: "./out" },
  defaults: {},
  modules: [apiV1, apiV2] as const
})

export default AppOfApps.entrypoint(collision)
