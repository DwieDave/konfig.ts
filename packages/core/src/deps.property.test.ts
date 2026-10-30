import { Context, Effect, Layer } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import * as Dep from "./deps"

const arbName = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/)

const _resolve = <A>(input: { readonly need: Effect.Effect<A, never, never> }): A => Effect.runSync(input.need)

const _provided = <A, K extends string, N extends string>(input: {
  readonly need: Context.Service<Dep.Need<K, N>, A>
  readonly layer: Layer.Layer<Dep.Provide<K, N>>
}): string => String(_resolve({ need: Effect.provide(input.need, input.layer) }))

describe("provide/need round-trip", () => {
  it("every provide* layer satisfies its own Need and yields the provided name", () => {
    fc.assert(
      fc.property(arbName, (name) => {
        const resolved = [
          _provided({ need: Dep.Secret(name), layer: Dep.provideSecret(name) }),
          _provided({ need: Dep.ConfigMap(name), layer: Dep.provideConfigMap(name) }),
          _provided({ need: Dep.Namespace(name), layer: Dep.provideNamespace(name) }),
          _provided({ need: Dep.ServiceAccount(name), layer: Dep.provideServiceAccount(name) }),
          _provided({ need: Dep.Application(name), layer: Dep.provideApplication(name) }),
          _provided({ need: Dep.Pvc(name), layer: Dep.providePvc(name) })
        ]
        expect(resolved.every((v) => v === name)).toBe(true)
      })
    )
  })

  it("a layer never satisfies a Need of a different name or kind", () => {
    fc.assert(
      fc.property(arbName, arbName, (a, b) => {
        fc.pre(a !== b)
        const context = Effect.runSync(Layer.build(Dep.provideSecret(a)).pipe(Effect.scoped, Effect.map((c) => c)))
        expect(Context.getOption(context, Dep.Secret(a))._tag).toBe("Some")
        expect(Context.getOption(context, Dep.Secret(b))._tag).toBe("None")
        expect(Context.getOption(context, Dep.ConfigMap(a))._tag).toBe("None")
      })
    )
  })

  it("merged layers resolve every provided name independently", () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbName, { minLength: 2, maxLength: 5 }), ([first, second]) => {
        const layer = Layer.mergeAll(Dep.provideNamespace(first!), Dep.provideNamespace(second!))
        const both = Effect.all([Dep.Namespace(first!), Dep.Namespace(second!)])
        expect(_resolve({ need: Effect.provide(both, layer) })).toEqual([first, second])
      })
    )
  })
})

describe("BuiltImageRef.of", () => {
  it("renders registry/app:tag and provideImage yields the same ref", () => {
    const arbPart = fc.stringMatching(/^[a-z0-9.-]{1,12}$/)
    fc.assert(
      fc.property(arbPart, arbPart, arbPart, (registry, app, tag) => {
        const ref = Dep.BuiltImageRef.of({ app, registry, tag })
        expect(ref).toBe(`${registry}/${app}:${tag}`)
        const provided = _resolve({ need: Effect.provide(Dep.Image(app), Dep.provideImage({ app, registry, tag })) })
        expect(provided).toBe(ref)
      })
    )
  })
})
