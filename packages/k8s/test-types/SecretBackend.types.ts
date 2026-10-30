import { Manifest } from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"
import { Backend, Environment, Secret } from "@konfig.ts/k8s"
import { Effect } from "effect"
import type { SecretBackend } from "../src/backendKit"

type BackendEmitInput<N extends string, K extends string, RS extends boolean> = Backend.BaseInput<N, K, RS>

type _BarrelHelpers = [typeof Backend.plainSecret, typeof Backend.secretMeta, typeof Backend.define]

interface DefinedOpts {
  readonly flag?: boolean
}

const defined = Backend.define({
  tag: "Defined",
  requiresSource: false,
  emit: <N extends string, K extends string>(input: Backend.EmitInput<N, K, DefinedOpts, false>) =>
    Manifest.make(() => Effect.succeed({ kind: input.base.name }))
})

const inferred: SecretBackend<"n", "k", false, { readonly kind: string }> = defined()

type _DefineInfersNameAndKeys = Expect<
  Equal<typeof inferred, SecretBackend<"n", "k", false, { readonly kind: string }>>
>

void inferred

// @ts-expect-error SecretBackend is not exported from the barrel
type _NoBarrelSecretBackend = import("../src/index").SecretBackend<"n", "k">

// @ts-expect-error Backend.Contract was removed
type _NoContract = Backend.Contract<"n", "k">

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

declare const reqTrue: SecretBackend<"x", "k", true>
declare const reqFalse: SecretBackend<"x", "k", false>

type _Backend_NotAssignable = Expect<
  Equal<typeof reqTrue extends SecretBackend<"x", "k", false> ? true : false, false>
>

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

declare const noSecrets: () => ReturnType<typeof Secret.define>

void noSecrets

declare const dbCreds: ReturnType<
  typeof Secret.define<"db-creds", { readonly url: "DATABASE_URL" }>
>

declare const lit: { readonly _kind: "Literal" }

void lit

void dbCreds

void Environment

type _Defaulted = Expect<
  Equal<SecretBackend<"n", "k">, SecretBackend<"n", "k", boolean>>
>

export type _Tests = readonly [
  _Backend_NotAssignable,
  _BackendEmitInputRequired,
  _BackendEmitInputOptional,
  _Defaulted,
  _DefineInfersNameAndKeys
]

void reqFalse
