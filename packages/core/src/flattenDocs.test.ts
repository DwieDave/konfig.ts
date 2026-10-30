import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { parseYamlAll } from "./diff"
import { flattenDocs } from "./flattenDocs"
import * as Manifest from "./Manifest"
import { renderAllYamlEffect } from "./render"

interface K8sDoc {
  readonly apiVersion: string
  readonly kind: string
  readonly metadata: { readonly name: string }
}

const _obj = (kind: string): K8sDoc => ({ apiVersion: "v1", kind, metadata: { name: "x" } })

const _run = <A, E>(effect: Effect.Effect<A, E, Manifest.RenderServices>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.runPromise)

const _parseChunks = (out: string) =>
  out === "" ? Effect.succeed([]) : Effect.forEach(out.split("---\n"), (chunk) => parseYamlAll(chunk))

const _renderTree = (tree: Tree) =>
  _run(
    renderAllYamlEffect({ manifests: [Manifest.make(() => tree)] }).pipe(
      Effect.flatMap(_parseChunks),
      Effect.map((groups) => groups.flat())
    )
  )

type Tree = ReadonlyArray<Tree> | null | undefined | K8sDoc | Manifest.RawYaml | Manifest.ParsedDoc

const _leafCount = (tree: Tree): number =>
  Array.isArray(tree) ? tree.reduce((n: number, t: Tree) => n + _leafCount(t), 0) : tree == null ? 0 : 1

const _arbTree = fc.letrec<{ tree: Tree; leaf: Tree }>((tie) => ({
  leaf: fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.stringMatching(/^[A-Z][a-z]{1,6}$/).map(_obj),
    fc.stringMatching(/^[A-Z][a-z]{1,6}$/).map((kind) => Manifest.RawYaml.make({ content: `kind: ${kind}\n` })),
    fc.stringMatching(/^[A-Z][a-z]{1,6}$/).map((kind) => Manifest.ParsedDoc.make({ value: _obj(kind) }))
  ),
  tree: fc.oneof({ depthSize: "small" }, tie("leaf"), fc.array(tie("tree"), { maxLength: 4 }))
})).tree

describe("flattenDocs", () => {
  it("emits two mapping documents for a nested tuple", async () => {
    const docs = await _renderTree([_obj("Deployment"), [_obj("Service")]])
    expect(docs).toEqual([_obj("Deployment"), _obj("Service")])
  })

  it("flattens an Effect.all of arrays", async () => {
    const m = Manifest.make(() => Effect.all([Effect.succeed([_obj("A")]), Effect.succeed([[_obj("B")]])]))

    const docs = await _run(
      renderAllYamlEffect({ manifests: [m] }).pipe(
        Effect.flatMap(_parseChunks),
        Effect.map((groups) => groups.flat())
      )
    )

    expect(docs).toEqual([_obj("A"), _obj("B")])
  })

  it("property: no document is a sequence and the count equals the non-null leaves", async () => {
    await fc.assert(
      fc.asyncProperty(_arbTree, async (tree) => {
        const docs = await _renderTree(tree)
        expect(docs.some((d) => Array.isArray(d))).toBe(false)
        expect(docs.length).toBe(_leafCount(tree))
        expect((await _run(flattenDocs(tree))).length).toBe(_leafCount(tree))
      }),
      { numRuns: 100 }
    )
  })
})
