import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import * as fc from "fast-check"
import * as fsNode from "node:fs"
import * as os from "node:os"
import * as nodePath from "node:path"
import { describe, expect, it } from "vitest"
import { walkFiles } from "./walkFiles"

const names = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 6 })

describe("walkFiles", () => {
  it("finds every nested file, and none under skipped dirs", async () => {
    await fc.assert(
      fc.asyncProperty(names, async (files) => {
        const root = fsNode.mkdtempSync(nodePath.join(os.tmpdir(), "walk-"))
        fsNode.mkdirSync(nodePath.join(root, "a", "b"), { recursive: true })
        fsNode.mkdirSync(nodePath.join(root, "skip"))
        files.forEach((f) => {
          fsNode.writeFileSync(nodePath.join(root, "a", "b", f), "")
          fsNode.writeFileSync(nodePath.join(root, "skip", f), "")
        })

        const found = await Effect.runPromise(
          walkFiles({ dir: root, skipDir: ({ name }) => name === "skip" }).pipe(Effect.provide(NodeServices.layer))
        )

        fsNode.rmSync(root, { recursive: true })
        expect(found.sort()).toEqual(files.map((f) => nodePath.join(root, "a", "b", f)).sort())
      }),
      { numRuns: 15 }
    )
  })
})
