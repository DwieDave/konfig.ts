import { omitUndefined } from "@konfig.ts/core"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { SyncPolicy } from "./Application"
import { mergeSyncPolicy } from "./syncPolicy"

const automated = fc.option(
  fc.record({
    enabled: fc.option(fc.boolean(), { nil: undefined }),
    prune: fc.option(fc.boolean(), { nil: undefined }),
    selfHeal: fc.option(fc.boolean(), { nil: undefined }),
    allowEmpty: fc.option(fc.boolean(), { nil: undefined })
  }, { requiredKeys: [] }),
  { nil: undefined }
)

const retry = fc.option(
  fc.record({
    limit: fc.integer({ min: 0, max: 10 }),
    backoff: fc.option(
      fc.record({ duration: fc.string(), factor: fc.integer({ min: 1, max: 5 }) }, {
        requiredKeys: []
      }),
      { nil: undefined }
    )
  }, { requiredKeys: [] }),
  { nil: undefined }
)

const policy: fc.Arbitrary<SyncPolicy | undefined> = fc.option(
  fc.record({
    automated,
    syncOptions: fc.option(fc.array(fc.string()), { nil: undefined }),
    retry
  }, { requiredKeys: [] }),
  { nil: undefined }
)

const definedPolicy = policy.filter((p): p is SyncPolicy => p !== undefined)

describe("mergeSyncPolicy properties", () => {
  it("returns the other side when one side is undefined", () => {
    fc.assert(fc.property(policy, (p) => {
      expect(mergeSyncPolicy({ def: undefined, app: p })).toBe(p)
      expect(mergeSyncPolicy({ def: p, app: undefined })).toBe(p)
    }))
  })

  it("enabled:false opts out of default automated", () => {
    fc.assert(fc.property(definedPolicy, (def) => {
      const merged = mergeSyncPolicy({
        def: { ...def, automated: { prune: true } },
        app: { automated: { enabled: false } }
      })

      expect(merged?.automated).toEqual({ enabled: false })
    }))
  })

  it("undefined app flags keep default flags", () => {
    fc.assert(fc.property(fc.boolean(), (prune) => {
      const merged = mergeSyncPolicy({
        def: { automated: { prune } },
        app: { automated: { prune: undefined, selfHeal: true } }
      })

      expect(merged?.automated).toEqual({ prune, selfHeal: true })
    }))
  })

  it("syncOptions prefer app over defaults", () => {
    fc.assert(fc.property(definedPolicy, definedPolicy, (def, app) => {
      expect(mergeSyncPolicy({ def, app })?.syncOptions).toEqual(app.syncOptions ?? def.syncOptions)
    }))
  })

  it("automated flags: app wins, defaults fill the gaps", () => {
    fc.assert(fc.property(definedPolicy, definedPolicy, (def, app) => {
      const merged = mergeSyncPolicy({ def, app })?.automated

      if (def.automated === undefined || app.automated === undefined) {
        expect(merged).toEqual(def.automated ?? app.automated)

        return
      }

      expect(merged).toEqual(
        app.automated.enabled === false
          ? omitUndefined(app.automated)
          : { ...def.automated, ...omitUndefined(app.automated) }
      )
    }))
  })

  it("retry backoff is merged, undefined only when both are", () => {
    fc.assert(fc.property(definedPolicy, definedPolicy, (def, app) => {
      const merged = mergeSyncPolicy({ def, app })?.retry

      if (def.retry === undefined || app.retry === undefined) {
        expect(merged).toBe(def.retry ?? app.retry)

        return
      }

      expect(merged?.limit).toBe(app.retry.limit ?? def.retry.limit)
      expect(merged?.backoff === undefined).toBe(def.retry.backoff === undefined && app.retry.backoff === undefined)
    }))
  })
})
