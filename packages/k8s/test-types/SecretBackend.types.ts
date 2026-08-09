import type { Manifest } from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"
import type { BackendEmitInput, BackendTag, SecretBackend } from "@konfig.ts/k8s"
import { Environment, Secret } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

declare const reqTrue: SecretBackend<"x", "k", true>
declare const reqFalse: SecretBackend<"x", "k", false>

type _Backend_NotAssignable = Expect<
  Equal<typeof reqTrue extends SecretBackend<"x", "k", false> ? true : false, false>
>

type _BackendTag = Expect<
  Equal<BackendTag, "Sops" | "Sops.passthrough" | "SealedSecrets" | "ExternalSecrets" | "NativeSecret">
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

const noSecrets = () => null as unknown as ReturnType<typeof Secret.define>
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
  _BackendTag,
  _BackendEmitInputRequired,
  _BackendEmitInputOptional,
  _Defaulted
]

void reqFalse
