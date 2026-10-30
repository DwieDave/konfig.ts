import { describe, expect, it } from "vitest"
import * as Core from "./index"
// @ts-expect-error PvcRefName is not part of the barrel
import type { PvcRefName } from "./index"

describe("core barrel", () => {
  it("exposes RENDER_CONCURRENCY on Manifest and flattenDocs", () => {
    expect(Core.Manifest.RENDER_CONCURRENCY).toBe(4)
    expect("flattenDocs" in Core).toBe(true)
  })

  it.each([
    "render",
    "parseYaml",
    "ProcessInvocationError",
    "decodeKonfigConfigEffect",
    "decodeKonfigConfigSync",
    "helmCacheDirConfig",
    "unwrapDocs",
    "isRawYaml",
    "isParsedDoc"
  ])("does not export %s", (name) => {
    expect(name in Core).toBe(false)
  })

  it.each(["existsOrFalse", "readOrEmpty", "findUp", "orElseIfNotFound", "strictParseOptions", "sha256Hex"])(
    "exports %s",
    (name) => {
      expect(name in Core).toBe(true)
    }
  )

  it("does not export the PvcRefName type", () => {
    const probe: PvcRefName<string> = "x"
    expect(probe).toBe("x")
  })
})
