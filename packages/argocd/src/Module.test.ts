import { Dep, Module } from "@konfig.ts/core"
import { Effect } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"
import { Application, AppOfApps, Sync } from "./index"

const source: Application.ArgoSource = {
  repoURL: "ssh://git@github.com/example/infra.git",
  targetRevision: "main",
  path: "./infra/k8s/manifests/prod/sops-secrets-operator"
}

const handleEffect = <Name extends string, Out, In>(
  handle: Application.ApplicationHandle<Name, Out, In>
) => handle.pipe(Effect.provide(handle.layer))

describe("Module.fixedNs({ target: Application.target, ... })", () => {
  const defineSops = Module.fixedNs({
    target: Application.target,
    namespace: "sops",
    annotations: Sync.wave(-1),
    build: ({ name, namespace }, opts: { readonly note?: string }) => [
      { kind: "ServiceAccount", name, namespace, note: opts.note }
    ]
  })

  it("preserves the chosen name as a literal in the result type", () => {
    const sops = defineSops({ name: "sops-secrets-operator", source })

    type NameOf<T> = T extends Application.ApplicationHandle<infer N, infer _Out, infer _In> ? N : never
    expectTypeOf<NameOf<typeof sops>>().toEqualTypeOf<"sops-secrets-operator">()
  })

  it("bakes the configured namespace into every instance", () => {
    const sops = defineSops({ name: "sops-secrets-operator", source })
    const app = Effect.runSync(handleEffect(sops))

    expect(app.name).toBe("sops-secrets-operator")
    expect(app.namespace).toBe("sops")
    expect(app.annotations).toEqual({ "argocd.argoproj.io/sync-wave": "-1" })
    expect(app.manifests).toEqual([
      { kind: "ServiceAccount", name: "sops-secrets-operator", namespace: "sops", note: undefined }
    ])
  })

  it("threads module-specific opts to the build callback", () => {
    const sops = defineSops({
      name: "sops-secrets-operator",
      source,
      note: "hello"
    })
    const app = Effect.runSync(handleEffect(sops))

    expect(app.manifests).toEqual([
      { kind: "ServiceAccount", name: "sops-secrets-operator", namespace: "sops", note: "hello" }
    ])
  })

  it("accepts an Effect-returning build", () => {
    const defineWithEffect = Module.fixedNs({
      target: Application.target,
      namespace: "demo",
      build: ({ name, namespace }, _opts: Record<never, never>) => Effect.succeed([{ kind: "Cm", name, namespace }])
    })

    const handle = defineWithEffect({ name: "demo-app", source })
    const app = Effect.runSync(handleEffect(handle))

    expect(app.manifests).toEqual([{ kind: "Cm", name: "demo-app", namespace: "demo" }])
  })

  it("rejects bare `string` for name at the call site", () => {
    const dynamicName = "x" as string
    // @ts-expect-error name must be a literal
    defineSops({ name: dynamicName, source })
  })
})

describe("Module.dynamicNs({ target: Application.target, ... })", () => {
  const defineApi = Module.dynamicNs({
    target: Application.target,
    annotations: Sync.wave(1),
    build: ({ name, namespace }, opts: { readonly image: string }) => [
      { kind: "Deployment", name, namespace, image: opts.image }
    ]
  })

  it("preserves both chosen name and namespace as literals", () => {
    const api = defineApi({
      name: "api",
      namespace: "prod",
      source,
      image: "ghcr.io/example/api:1.0"
    })

    type NameOf<T> = T extends Application.ApplicationHandle<infer N, infer _Out, infer _In> ? N : never
    expectTypeOf<NameOf<typeof api>>().toEqualTypeOf<"api">()
  })

  it("uses the per-instance namespace in the resulting Application", () => {
    const apiProd = defineApi({
      name: "api",
      namespace: "prod",
      source,
      image: "ghcr.io/example/api:1.0"
    })
    const apiStaging = defineApi({
      name: "api-staging",
      namespace: "staging",
      source,
      image: "ghcr.io/example/api:1.0"
    })

    expect(Effect.runSync(handleEffect(apiProd)).namespace).toBe("prod")
    expect(Effect.runSync(handleEffect(apiStaging)).namespace).toBe("staging")
  })

  it("rejects bare `string` for namespace at the call site", () => {
    const dynamicNs = "x" as string
    defineApi({
      name: "api",
      // @ts-expect-error namespace must be a literal
      namespace: dynamicNs,
      source,
      image: "x"
    })
  })
})

describe("Application.module({ ... })", () => {
  const defineSops = Application.module({
    namespace: "sops",
    annotations: Sync.wave(-1),
    build: ({ name, namespace }, opts: { readonly note?: string }) => [
      { kind: "ServiceAccount", name, namespace, note: opts.note }
    ]
  })

  it("behaves like Module.fixedNs with Application.target pinned", () => {
    const sops = defineSops({ name: "sops-secrets-operator", source, note: "hello" })
    const app = Effect.runSync(handleEffect(sops))

    type NameOf<T> = T extends Application.ApplicationHandle<infer N, infer _Out, infer _In> ? N : never
    expectTypeOf<NameOf<typeof sops>>().toEqualTypeOf<"sops-secrets-operator">()
    expect(app.namespace).toBe("sops")
    expect(app.annotations).toEqual({ "argocd.argoproj.io/sync-wave": "-1" })
    expect(app.manifests).toEqual([
      { kind: "ServiceAccount", name: "sops-secrets-operator", namespace: "sops", note: "hello" }
    ])
  })

  it("infers Extra from a bare provides layer", () => {
    const definePulls = Application.module({
      namespace: "app",
      provides: Dep.provideSecret("ghcr-pull"),
      build: (_ctx, _opts: Record<never, never>) => []
    })
    const pulls = definePulls({ name: "pulls", source })

    type OutOf<T> = T extends Application.ApplicationHandle<infer _N, infer Out, infer _In> ? Out : never
    expectTypeOf<Dep.Provide<"Secret", "ghcr-pull">>().toExtend<OutOf<typeof pulls>>()
  })

  it("keeps the AppOfApps residual-dependency check", () => {
    const defineApi = Application.module({
      namespace: "app",
      build: (_ctx) =>
        Effect.gen(function*() {
          yield* Dep.Secret("ghcr-pull")
          return []
        })
    })
    const definePulls = Application.module({
      namespace: "app",
      provides: Dep.provideSecret("ghcr-pull"),
      build: (_ctx) => []
    })
    const target = { repoURL: "ssh://git@example/repo.git", branch: "main", rootPath: "./apps" }

    const api = defineApi({ name: "api", source })
    const pulls = definePulls({ name: "pulls", source })
    void AppOfApps.entrypoint(AppOfApps.fromModules({ target, defaults: {}, modules: [pulls, api] as const }))

    const apiAlone = defineApi({ name: "api-alone", source })
    void AppOfApps.entrypoint(
      // @ts-expect-error Secret "ghcr-pull" is unsatisfied (_konfig_unsatisfied)
      AppOfApps.fromModules({ target, defaults: {}, modules: [apiAlone] as const })
    )
  })

  it("rejects bare `string` for name at the call site", () => {
    const dynamicName = "x" as string
    // @ts-expect-error name must be a literal
    defineSops({ name: dynamicName, source })
  })
})
