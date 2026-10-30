import { describe, expect, it } from "vitest"
import * as Manifest from "./Manifest"
import { renderAllYaml } from "./render"

describe("renderAllYaml — skipped manifests", () => {
  it("skips a manifest rendering undefined instead of crashing", async () => {
    const skipped = Manifest.make(() => undefined)
    const kept = Manifest.make(() => ({ kind: "B" }))
    const out = await renderAllYaml({ manifests: [skipped, kept] })
    expect(out).toBe("kind: B\n")
  })
})
