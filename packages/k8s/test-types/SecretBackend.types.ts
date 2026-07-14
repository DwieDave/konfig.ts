// Compile-time-only assertions for `SecretBackend<N, K, RequiresSource>`
// and `Environment.bind`'s discriminated input shape.

import type { Manifest } from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"
import type { BackendEmitInput, BackendTag, SecretBackend } from "@konfig.ts/k8s"
import { Environment, Secret } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

// 1 · A backend with RequiresSource=true and one with false are NOT
//     mutually assignable — the type parameter is invariant in the
//     option position.
declare const reqTrue: SecretBackend<"x", "k", true>
declare const reqFalse: SecretBackend<"x", "k", false>

type _Backend_NotAssignable = Expect<
  Equal<typeof reqTrue extends SecretBackend<"x", "k", false> ? true : false, false>
>

// 2 · BackendTag is the literal union.
type _BackendTag = Expect<
  Equal<BackendTag, "Sops" | "Sops.passthrough" | "SealedSecrets" | "ExternalSecrets" | "NativeSecret">
>

// 3 · BackendEmitInput is shaped as documented — `source` is required
//     when RequiresSource is `true`, and `SecretSource | undefined` when
//     `false`.
type _BackendEmitInputRequired = Expect<
  Equal<
    BackendEmitInput<"n", "k", true>,
    {
      readonly name: "n"
      readonly namespace: string
      readonly keys: ReadonlyArray<"k">
      readonly labels?: Readonly<Record<string, string>>
      readonly annotations?: Readonly<Record<string, string>>
      readonly source: SecretSource<"k", Manifest.RenderServices>
    }
  >
>

type _BackendEmitInputOptional = Expect<
  Equal<
    BackendEmitInput<"n", "k", false>,
    {
      readonly name: "n"
      readonly namespace: string
      readonly keys: ReadonlyArray<"k">
      readonly labels?: Readonly<Record<string, string>>
      readonly annotations?: Readonly<Record<string, string>>
      readonly source: SecretSource<"k", Manifest.RenderServices> | undefined
    }
  >
>

// 4 · A bundle without secrets makes Environment.bind's `secrets`
//     field optional; with a secret it becomes required.
const noSecrets = () => null as unknown as ReturnType<typeof Secret.define>
void noSecrets

declare const dbCreds: ReturnType<
  typeof Secret.define<"db-creds", { readonly url: "DATABASE_URL" }>
>

declare const lit: { readonly _kind: "Literal" }
void lit

// Bundles aren't easily constructed in a typecheck-only file, so we
// rely on the conditional shape `HasSecrets` exposed at the bind
// site: passing `secrets: {}` to a no-secret bundle is OK, while
// omitting `secrets` for a with-secret bundle is a TS error caught by
// `examples/full-stack/infra/envs/unbound-secret.ts`.
void dbCreds
void Environment

// 5 · `SecretBackend<N, K, RequiresSource>` defaults RequiresSource
//     to `boolean` so the type signature without the third param
//     accepts both kinds.
type _Defaulted = Expect<
  Equal<SecretBackend<"n", "k">, SecretBackend<"n", "k", boolean>>
>

export type _Tests = readonly [
  _Backend_NotAssignable,
  _BackendTag,
  _BackendEmitInputRequired,
  _BackendEmitInputOptional,
  _Defaulted
]

void reqFalse
