import { unsafeCoerce } from "@konfig.ts/core"
import { type Config, Effect } from "effect"
import type { Environment, EnvMember } from "./environment"
import type { EnvironmentShape } from "./layer"

// Runtime half of an env contract: the same bundle that drives
// Environment.bind in the konfig modules drives this decode in the running app.
export const runtime = <M extends Readonly<Record<string, EnvMember>>>(
  env: Environment<M>
): Effect.Effect<EnvironmentShape<M>, Config.ConfigError> =>
  Effect.gen(function*() {
    const decoded = yield* env
    return unsafeCoerce<EnvironmentShape<M>>(
      decoded,
      "Environment<M> extends Config<{ [K in keyof M]: MemberValue<M[K]> }>, structurally equal to EnvironmentShape<M> by definition"
    )
  })
