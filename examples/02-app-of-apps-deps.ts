import { Application, AppOfApps } from "@konfig.ts/argocd"
import { Dep } from "@konfig.ts/core"
import { Effect, Layer } from "effect"

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

const program = Effect.gen(function*() {
  const infraApp = yield* infra
  const webApp = yield* web
  return AppOfApps.make({
    target: {
      repoURL: "ssh://git@github.com/example/infra.git",
      branch: "main",
      rootPath: "./apps"
    },
    defaults: { destination: { server: "https://kubernetes.default.svc" } },
    apps: [infraApp, webApp]
  })
}).pipe(Effect.provide(web.layer.pipe(Layer.provideMerge(infra.layer))))

const checked = AppOfApps.entrypoint(program)

const broken = Effect.gen(function*() {
  const webApp = yield* web
  return AppOfApps.make({
    target: {
      repoURL: "ssh://git@github.com/example/infra.git",
      branch: "main",
      rootPath: "./apps"
    },
    defaults: {},
    apps: [webApp]
  })
}).pipe(Effect.provide(web.layer))

// @ts-expect-error  Need<"Secret", "ghcr-pull"> is not assignable to never
// @effect-diagnostics-next-line floatingEffect:off — deliberately-broken demo call, never executed
AppOfApps.entrypoint(broken)

const report = Effect.gen(function*() {
  const result = yield* checked
  yield* Effect.log(`AppOfApps "${result.name}" — ${result.apps.length} apps`)
  for (const a of result.apps) {
    yield* Effect.log(`  • ${a.namespace}/${a.name}`)
  }
})

Effect.runPromise(report)
