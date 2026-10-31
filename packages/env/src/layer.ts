import type { Config, Context } from "effect"
import { Layer } from "effect"
import type { Environment, EnvironmentValues, EnvMember } from "./environment"
import { runtime } from "./runtime"

export type EnvironmentShape<M extends Readonly<Record<string, EnvMember>>> = EnvironmentValues<M>

// The environment is decoded once at layer build; services read that record
// instead of each repeating the Config reads.
interface EnvironmentLayerInput<Self, M extends Readonly<Record<string, EnvMember>>> {
  readonly tag: Context.Service<Self, EnvironmentValues<M>>
  readonly env: Environment<M>
}

export const environmentLayer = <Self, M extends Readonly<Record<string, EnvMember>>>(
  input: EnvironmentLayerInput<Self, M>
): Layer.Layer<Self, Config.ConfigError> => Layer.effect(input.tag, runtime(input.env))
