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

describe("walkFiles symlinks", () => {
  it("skips back-links and terminates quickly", async () => {
    const root = fsNode.mkdtempSync(nodePath.join(os.tmpdir(), "walk-"))
    fsNode.mkdirSync(nodePath.join(root, "a"))
    fsNode.writeFileSync(nodePath.join(root, "a", "f"), "")
    fsNode.symlinkSync("..", nodePath.join(root, "a", "l1"))
    fsNode.symlinkSync("..", nodePath.join(root, "a", "l2"))
    const found = await Effect.runPromise(walkFiles({ dir: root }).pipe(Effect.provide(NodeServices.layer)))
    fsNode.rmSync(root, { recursive: true })
    expect(found).toEqual([nodePath.join(root, "a", "f")])
  }, 1000)
})

describe("walkFiles symlink handling", () => {
  it("returns each file once with a single back-link", async () => {
    const root = fsNode.mkdtempSync(nodePath.join(os.tmpdir(), "walk-"))
    fsNode.mkdirSync(nodePath.join(root, "a"))
    fsNode.writeFileSync(nodePath.join(root, "a", "f"), "")
    fsNode.symlinkSync("..", nodePath.join(root, "a", "loop"))
    const found = await Effect.runPromise(walkFiles({ dir: root }).pipe(Effect.provide(NodeServices.layer)))
    fsNode.rmSync(root, { recursive: true })
    expect(found).toEqual([nodePath.join(root, "a", "f")])
  }, 1000)

  it("returns symlinked files but skips symlinked directories", async () => {
    const root = fsNode.mkdtempSync(nodePath.join(os.tmpdir(), "walk-"))
    fsNode.writeFileSync(nodePath.join(root, "real"), "")
    fsNode.symlinkSync("real", nodePath.join(root, "alias"))
    fsNode.mkdirSync(nodePath.join(root, "d"))
    fsNode.writeFileSync(nodePath.join(root, "d", "x"), "")
    fsNode.symlinkSync("d", nodePath.join(root, "dlink"))
    const found = await Effect.runPromise(walkFiles({ dir: root }).pipe(Effect.provide(NodeServices.layer)))
    fsNode.rmSync(root, { recursive: true })
    expect(found.sort()).toEqual(["alias", "d/x", "real"].map((f) => nodePath.join(root, f)).sort())
  })
})

describe("walkFiles unreadable directory", () => {
  it("fails with a typed PlatformError instead of dying", async () => {
    const root = fsNode.mkdtempSync(nodePath.join(os.tmpdir(), "walk-"))
    const locked = nodePath.join(root, "locked")
    fsNode.mkdirSync(locked)
    fsNode.chmodSync(locked, 0o000)

    const error = await Effect.runPromise(
      Effect.flip(walkFiles({ dir: root }).pipe(Effect.provide(NodeServices.layer))).pipe(
        Effect.ensuring(Effect.sync(() => {
          fsNode.chmodSync(locked, 0o700)
          fsNode.rmSync(root, { recursive: true })
        }))
      )
    )

    expect(error._tag).toBe("PlatformError")
  })
})
