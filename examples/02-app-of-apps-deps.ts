import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Application, AppOfApps } from "@konfig.ts/argocd"
import { Dep } from "@konfig.ts/core"
import { Effect } from "effect"

const infra = Application.define({
  name: "infra",
  namespace: "infra",
  source: {
    repoURL: "ssh://git@github.com/example/infra.git",
    targetRevision: "main",
    path: "./apps/infra"
  },
  build: Effect.succeed([]),
  provides: Dep.provideSecret("ghcr-pull")
})

const web = Application.define({
  name: "web",
  namespace: "prod",
  source: {
    repoURL: "ssh://git@github.com/example/infra.git",
    targetRevision: "main",
    path: "./apps/web"
  },
  build: Effect.gen(function*() {
    const ghcrRef = yield* Dep.Secret("ghcr-pull")
    void ghcrRef
    return []
  })
})

const target = {
  repoURL: "ssh://git@github.com/example/infra.git",
  branch: "main",
  rootPath: "./apps"
}

// (A) Happy path — `infra` precedes `web`, so its Provide<Secret, "ghcr-pull">
// supplies `web`'s Need. The residual-dep check fires right here in
// fromModules; no entrypoint wrapper needed.
const checked = AppOfApps.fromModules({
  target,
  defaults: { destination: { server: "https://kubernetes.default.svc" } },
  modules: [infra, web] as const
})

// (B) Broken — `infra` omitted. web's Need<Secret, "ghcr-pull"> survives the
// fold and fromModules rejects with the `_konfig_unsatisfied` hint.
// @ts-expect-error - Missing provider for Secret "ghcr-pull".
// @effect-diagnostics-next-line floatingEffect:off — deliberately-broken demo call, never executed
AppOfApps.fromModules({ target, defaults: {}, modules: [web] as const })

const report = Effect.gen(function*() {
  const result = yield* checked
  yield* Effect.log(`AppOfApps "${result.name}" — ${result.apps.length} apps`)
  for (const a of result.apps) {
    yield* Effect.log(`  • ${a.namespace}/${a.name}`)
  }
})

NodeRuntime.runMain(report.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
