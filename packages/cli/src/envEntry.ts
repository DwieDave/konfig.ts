import type { ResolvedKonfigConfig } from "@konfig.ts/core"

export interface EnvEntryPathInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly pathJoin: (...parts: string[]) => string
}

export const envEntryPath = (input: EnvEntryPathInput): string => {
  const { cfg, envName, pathJoin } = input
  const envSpec = cfg.config.envs[envName]

  return envSpec === undefined
    ? pathJoin(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
    : pathJoin(cfg.configDir, cfg.config.root, envSpec.entry)
}
