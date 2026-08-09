// `env` keys both the output dir and the KonfigConfig.envs entry; output dir is
// `<outDir>/<env>/` or, when `cluster` is set, `<outDir>/<env>/<cluster>/`.
export interface RenderContext {
  readonly env: string
  readonly cluster?: string
  readonly k8sVersion?: string
  readonly flags?: ReadonlyMap<string, unknown>
}

export interface RenderContextFullInput {
  readonly env: string
  readonly cluster?: string
  readonly k8sVersion?: string
  readonly flags?: ReadonlyMap<string, unknown>
}

export const RenderContext = {
  make: (env: string): RenderContext => ({ env }),
  makeFull: (input: RenderContextFullInput): RenderContext => ({
    env: input.env,
    ...(input.cluster !== undefined ? { cluster: input.cluster } : {}),
    ...(input.k8sVersion !== undefined ? { k8sVersion: input.k8sVersion } : {}),
    ...(input.flags !== undefined ? { flags: input.flags } : {})
  })
}
