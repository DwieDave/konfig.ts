import { unsafeCoerce } from "@konfig.ts/core"
import { type Config, Effect } from "effect"
import type { Environment, EnvMember } from "./environment"
import type { EnvironmentShape } from "./layer"

/**
 * Read every member of an `Environment<M>` from the active
 * `ConfigProvider` and return the decoded record.
 *
 * This is the runtime half of an env contract — the same `apiEnv`
 * bundle that drives `Environment.bind` in the konfig modules drives
 * this decode in the running app. Add a new `Literal` /
 * `Secret` to the bundle and the runtime call surfaces it
 * automatically; remove one and the runtime call no longer reads it.
 *
 *   const config = yield* Environment.runtime(apiEnv);
 *   const port = config.http.port;
 *   const password = Redacted.value(config.db.password);
 */
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
