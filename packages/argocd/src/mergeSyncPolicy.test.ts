import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { SyncPolicy } from "./Application"
import { _mergeSyncPolicy } from "./emit"

const automated = fc.option(
  fc.record({
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

describe("_mergeSyncPolicy properties", () => {
  it("returns the other side when one side is undefined", () => {
    fc.assert(fc.property(policy, (p) => {
      expect(_mergeSyncPolicy({ def: undefined, app: p })).toBe(p)
      expect(_mergeSyncPolicy({ def: p, app: undefined })).toBe(p)
    }))
  })

  it("syncOptions prefer app over defaults", () => {
    fc.assert(fc.property(definedPolicy, definedPolicy, (def, app) => {
      expect(_mergeSyncPolicy({ def, app })?.syncOptions).toEqual(app.syncOptions ?? def.syncOptions)
    }))
  })

  it("automated flags: app wins, defaults fill the gaps", () => {
    fc.assert(fc.property(definedPolicy, definedPolicy, (def, app) => {
      const merged = _mergeSyncPolicy({ def, app })?.automated

      const expected = def.automated === undefined
        ? app.automated
        : app.automated === undefined
        ? def.automated
        : { ...def.automated, ...app.automated }

      expect(merged).toEqual(expected)
    }))
  })

  it("retry backoff is merged, undefined only when both are", () => {
    fc.assert(fc.property(definedPolicy, definedPolicy, (def, app) => {
      const merged = _mergeSyncPolicy({ def, app })?.retry

      if (def.retry === undefined || app.retry === undefined) {
        expect(merged).toBe(def.retry ?? app.retry)

        return
      }

      expect(merged?.limit).toBe(app.retry.limit ?? def.retry.limit)
      expect(merged?.backoff === undefined).toBe(def.retry.backoff === undefined && app.retry.backoff === undefined)
    }))
  })
})
