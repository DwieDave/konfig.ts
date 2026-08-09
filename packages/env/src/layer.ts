import type { Context, Effect } from "effect"
import { Layer } from "effect"
import type { Environment, EnvMember, MemberValue } from "./environment"

export type EnvironmentShape<M extends Readonly<Record<string, EnvMember>>> = {
  readonly [K in keyof M]: MemberValue<M[K]>
}

import { unsafeCoerce } from "@konfig.ts/core"

// Bundle is resolved once at Layer construction; downstream services read
// from that resolved record rather than each doing per-service Config reads.
export interface EnvironmentLayerInput<Self, M extends Readonly<Record<string, EnvMember>>> {
  readonly tag: Context.Service<Self, EnvironmentShape<M>>
  readonly env: Environment<M>
}

export const environmentLayer = <Self, M extends Readonly<Record<string, EnvMember>>>(
  input: EnvironmentLayerInput<Self, M>
): Layer.Layer<Self> =>
  Layer.effect(
    input.tag,
    unsafeCoerce<Effect.Effect<EnvironmentShape<M>>>(
      input.env,
      "Environment<M> extends Config<EnvironmentShape<M>>, and Config is structurally a no-deps Effect — Layer.effect accepts it"
    )
  )
