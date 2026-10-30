import { serializeApplicationCR } from "@konfig.ts/argocd"
import { Effect } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { decodeEnvResult, type EnvResult } from "./envResult"

const target = {}

const app = {
  name: "web",
  namespace: "web",
  manifests: [],
  source: { repoURL: "https://example.com/r.git", targetRevision: "main", path: "web" },
  syncPolicy: { automated: { enabled: false } }
}

const value = {
  name: "apps",
  target,
  defaults: { syncPolicy: { automated: { prune: true, selfHeal: true } } },
  apps: [app]
}

const str = fc.string({ maxLength: 8 })

const syncPolicyArb = fc.record({
  automated: fc.record(
    { enabled: fc.boolean(), prune: fc.boolean(), selfHeal: fc.boolean(), allowEmpty: fc.boolean() },
    { requiredKeys: [] }
  ),
  syncOptions: fc.array(str, { maxLength: 3 }),
  retry: fc.record({
    limit: fc.integer(),
    backoff: fc.record({ duration: str, factor: fc.integer(), maxDuration: str }, { requiredKeys: [] })
  }, { requiredKeys: [] })
}, { requiredKeys: [] })

const manifestsArb = fc.array(fc.jsonValue(), { maxLength: 2 })

const appArb = fc.record({
  name: str,
  namespace: str,
  manifests: manifestsArb,
  source: fc.record({ repoURL: str, targetRevision: str, path: str })
}).chain((base) =>
  fc.record({ syncPolicy: syncPolicyArb, annotations: fc.dictionary(str, str) }, { requiredKeys: [] }).map((extra) => ({
    ...base,
    ...extra
  }))
)

const aoaArb = fc.record({
  name: str,
  target: fc.constant(target),
  defaults: fc.record({ syncPolicy: syncPolicyArb }, { requiredKeys: [] }),
  apps: fc.array(appArb, { maxLength: 3 })
})

const bundleArb = fc.record({ name: str, manifests: manifestsArb }).chain((base) =>
  fc.record({ namespace: str }, { requiredKeys: [] }).map((extra) => ({ ...base, ...extra }))
)

const bundleSetArb = fc.record({ name: str, bundles: fc.array(bundleArb, { maxLength: 3 }) })

const decode = (x: EnvResult) => Effect.runPromise(decodeEnvResult(x))

describe("decodeEnvResult", () => {
  it("keeps automated.enabled === false", async () => {
    const decoded = await decode(value)
    expect(decoded).toEqual(value)
    expect(serializeApplicationCR({ app, target, defaults: value.defaults })).toContain("enabled: false")
  })

  it("round-trips arbitrary results", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(aoaArb, bundleSetArb), async (x) => {
        expect(await decode(x)).toEqual(x)
      })
    )
  })
})
