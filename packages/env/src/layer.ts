import type { Context } from "effect"
import { Effect, Layer } from "effect"
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
    // A missing env var fails the layer at build time either way; orDie keeps
    // the public Layer<Self> signature without erasing the ConfigError channel.
    Effect.orDie(runtime(input.env))
  )
