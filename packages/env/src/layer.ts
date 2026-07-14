import type { Context, Effect } from "effect"
import { Layer } from "effect"
import type { Environment, EnvMember, MemberValue } from "./environment"

/**
 * Type of the value an `Environment<M>` yields when consumed — the same
 * record type produced by `yield* env`.
 */
export type EnvironmentShape<M extends Readonly<Record<string, EnvMember>>> = {
  readonly [K in keyof M]: MemberValue<M[K]>
}

import { unsafeCoerce } from "@konfig.ts/core"

/**
 * Lift an `Environment` bundle into a service `Layer` so the app's
 * graph can depend on the yielded record once and DI it everywhere.
 *
 * The bundle is a yieldable `Config`; lifting it into a `Layer.effect`
 * bound to a `Context.Service` tag means the bundle is resolved once at
 * Layer construction time, and every downstream service that yields the
 * tag reads from the resolved record — no `Effect.runSync` at module
 * scope, no per-service `Config.string` reads.
 *
 *   class AppEnv extends Context.Service<AppEnv, EnvironmentShape<typeof bundleEnv.members>>()("AppEnv") {}
 *   export const AppEnvLive = environmentLayer({ tag: AppEnv, env: bundleEnv });
 *
 *   // downstream:
 *   const env = yield* AppEnv;
 *   const password = Redacted.value(env.postgres.password);
 */
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
