import { unsafeCoerce } from "@konfig.ts/core"
import type { Context, Effect } from "effect"
import { Layer } from "effect"
import type { Environment, EnvironmentShape, EnvMember } from "./environment"
import { runtime } from "./runtime"

export type { EnvironmentShape } from "./environment"

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
      runtime(input.env),
      "drops the ConfigError channel so environmentLayer keeps its Layer<Self> signature; a missing env var still fails the layer at build time, just untyped"
    )
  )
