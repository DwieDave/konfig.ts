import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Bundle, Dep } from "@konfig.ts/core"
import { Effect } from "effect"

const infra = Bundle.define({
  name: "infra",
  namespace: "infra",
  build: () => [],
  provides: Dep.provideSecret("ghcr-pull")
})

const web = Bundle.define({
  name: "web",
  namespace: "prod",
  build: Effect.gen(function*() {
    const ghcrRef = yield* Dep.Secret("ghcr-pull")
    void ghcrRef
    return [{ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "web-conf" } }]
  })
})

// (A) Happy path — `infra` precedes `web`, so its Provide<Secret, "ghcr-pull">
// supplies `web`'s Need. The residual-dep check fires right here in
// fromModules; no entrypoint wrapper needed.
const checked = Bundle.fromModules({ modules: [infra, web] as const })

// (B) Broken — `infra` omitted. The Need<Secret, "ghcr-pull"> on `web`'s
// environment slot survives the fold; fromModules rejects with the
// `_konfig_unsatisfied` hint.
// @ts-expect-error - Missing provider for Secret "ghcr-pull".
// @effect-diagnostics-next-line floatingEffect:off — deliberately-broken demo call, never executed
Bundle.fromModules({ modules: [web] as const })

const report = Effect.gen(function*() {
  const result = yield* checked
  yield* Effect.log(`BundleSet "${result.name}" — ${result.bundles.length} bundles`)
  for (const b of result.bundles) {
    yield* Effect.log(`  • ${b.namespace ?? "(cluster)"}/${b.name}`)
  }
})

NodeRuntime.runMain(report.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
