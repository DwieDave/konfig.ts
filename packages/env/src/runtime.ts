import type { Config, Effect } from "effect"
import type { Environment, EnvironmentShape, EnvMember } from "./environment"

// Runtime half of an env contract: the same bundle that drives
// Environment.bind in the konfig modules drives this decode in the running app.
// Environment<M> extends Config<EnvironmentShape<M>>, and Config<T> is an
// Effect<T, ConfigError>, so the contract is the decode effect itself.
export const runtime = <M extends Readonly<Record<string, EnvMember>>>(
  env: Environment<M>
): Effect.Effect<EnvironmentShape<M>, Config.ConfigError> => env
