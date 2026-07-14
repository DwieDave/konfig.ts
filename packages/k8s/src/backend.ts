import type { Manifest } from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"

export type BackendTag =
  | "Sops"
  | "Sops.passthrough"
  | "SealedSecrets"
  | "ExternalSecrets"
  | "NativeSecret"

export interface BackendEmitInput<
  N extends string,
  K extends string,
  RequiresSource extends boolean = boolean
> {
  readonly name: N
  readonly namespace: string
  readonly keys: ReadonlyArray<K>
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  readonly source: RequiresSource extends true ? SecretSource<K, Manifest.RenderServices>
    : SecretSource<K, Manifest.RenderServices> | undefined
}

export interface SecretBackend<
  N extends string,
  K extends string,
  RequiresSource extends boolean = boolean,
  Out = unknown
> {
  readonly _tag: BackendTag
  readonly requiresSource: RequiresSource
  readonly emit: (input: BackendEmitInput<N, K, RequiresSource>) => Manifest.Manifest<Out>
}
