import { Effect } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"
import * as Bundle from "./Bundle"
import * as Module from "./Module"

const handleEffect = <Name extends string, Out, In>(
  handle: Bundle.BundleHandle<Name, Out, In>
) => handle.pipe(Effect.provide(handle.layer))

describe("Module.fixedNs({ target: Bundle.target, ... })", () => {
  const defineCertManager = Module.fixedNs({
    target: Bundle.target,
    namespace: "cert-manager",
    build: ({ name, namespace }, opts: { readonly version?: string }) => [
      { kind: "Namespace", name: namespace },
      { kind: "Bundle", name, namespace, version: opts.version ?? "default" }
    ]
  })

  it("preserves the chosen name as a literal", () => {
    const cm = defineCertManager({ name: "cert-manager" })

    type NameOf<T> = T extends Bundle.BundleHandle<infer N, infer _Out, infer _In> ? N : never

    expectTypeOf<NameOf<typeof cm>>().toEqualTypeOf<"cert-manager">()
  })

  it("bakes the configured namespace and runs the build", () => {
    const cm = defineCertManager({ name: "cert-manager", version: "v1.14" })
    const bundle = Effect.runSync(handleEffect(cm))

    expect(bundle.name).toBe("cert-manager")
    expect(bundle.namespace).toBe("cert-manager")
    expect(bundle.manifests).toEqual([
      { kind: "Namespace", name: "cert-manager" },
      { kind: "Bundle", name: "cert-manager", namespace: "cert-manager", version: "v1.14" }
    ])
  })

  it("rejects bare `string` for name at the call site", () => {
    const dynamicName: string = "x"
    // @ts-expect-error — `name` must be a literal
    defineCertManager({ name: dynamicName })
  })
})

describe("Module.dynamicNs({ target: Bundle.target, ... })", () => {
  const defineCache = Module.dynamicNs({
    target: Bundle.target,
    build: ({ name, namespace }, opts: { readonly sizeGi: number }) => [
      { kind: "Pvc", name, namespace, sizeGi: opts.sizeGi }
    ]
  })

  it("uses the per-instance namespace", () => {
    const prod = defineCache({ name: "cache", namespace: "prod", sizeGi: 50 })
    const staging = defineCache({ name: "cache", namespace: "staging", sizeGi: 10 })

    expect(Effect.runSync(handleEffect(prod)).namespace).toBe("prod")
    expect(Effect.runSync(handleEffect(staging)).namespace).toBe("staging")
    expect(Effect.runSync(handleEffect(prod)).manifests).toEqual([
      { kind: "Pvc", name: "cache", namespace: "prod", sizeGi: 50 }
    ])
  })

  it("rejects bare `string` for namespace at the call site", () => {
    const dynamicNs: string = "x"
    defineCache({
      name: "cache",
      // @ts-expect-error — `namespace` must be a literal
      namespace: dynamicNs,
      sizeGi: 1
    })
  })
})

describe("Module Opts that collide with the define contract", () => {
  it("rejects Opts keys overlapping name/namespace/build/provides at the call site", () => {
    const fixed = Module.fixedNs({
      target: Bundle.target,
      namespace: "ns",
      build: (_c, _o: { provides: string }) => []
    })

    // @ts-expect-error provides collides with DefineBaseArgs
    fixed({ name: "b", provides: "oops" })

    const dynamic = Module.dynamicNs({
      target: Bundle.target,
      build: (_c, _o: { build: string; namespace: number }) => []
    })

    // @ts-expect-error build and namespace collide with DefineBaseArgs
    dynamic({ name: "b", namespace: "ns", build: "x" })

    expect(true).toBe(true)
  })

  it("passes only name, namespace and build to define when Opts is empty", () => {
    const seen: Array<ReadonlyArray<string>> = []

    const target: Module.Target<Module.HandleKind, Record<never, never>, Record<never, never>> = {
      define: (args) => {
        seen.push(Object.keys(args).sort())

        return args.name
      }
    }

    Module.fixedNs({ target, namespace: "ns", build: () => [] })({ name: "b" })

    expect(seen).toEqual([["build", "name", "namespace"]])
  })
})

describe("Module.asLiteralName", () => {
  it("returns the value unchanged and keeps a literal type", () => {
    const name = Module.asLiteralName("api")
    expectTypeOf(name).toEqualTypeOf<"api">()
    expect(name).toBe("api")
  })

  it("lets a generic wrapper forward a literal into LiteralName", () => {
    const forward = <const N extends string>(n: N): Module.LiteralName<N> => Module.asLiteralName(n)
    expect(forward("web")).toBe("web")
  })
})
