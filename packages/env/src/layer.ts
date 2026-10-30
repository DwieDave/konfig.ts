import type { Config, Context } from "effect"
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
): Layer.Layer<Self, Config.ConfigError> =>
  Layer.effect(
    input.tag,
    runtime(input.env)
  )
