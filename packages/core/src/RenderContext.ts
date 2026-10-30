import { omitUndefined } from "./omitUndefined"

// `env` keys both the output dir and the KonfigConfig.envs entry; output dir is
// `<outDir>/<env>/` or, when `cluster` is set, `<outDir>/<env>/<cluster>/`.
export interface RenderContext {
  readonly env: string
  readonly cluster?: string
  readonly k8sVersion?: string
  readonly flags?: ReadonlyMap<string, unknown>
}

export const RenderContext = {
  make: (env: string): RenderContext => ({ env }),
  makeFull: (input: RenderContext): RenderContext => ({
    env: input.env,
    ...omitUndefined({ cluster: input.cluster, k8sVersion: input.k8sVersion, flags: input.flags })
  })
}
