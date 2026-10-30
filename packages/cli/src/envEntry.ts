import { Effect } from "effect"
import { Path } from "effect/Path"
import type { EnvTarget } from "./buildEnv"

export const envEntryPath = (input: Pick<EnvTarget, "cfg" | "envName">) =>
  Effect.gen(function*() {
    const path = yield* Path
    const { cfg, envName } = input
    const envSpec = cfg.config.envs[envName]

    return envSpec === undefined
      ? path.join(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
      : path.join(cfg.configDir, cfg.config.root, envSpec.entry)
  })
