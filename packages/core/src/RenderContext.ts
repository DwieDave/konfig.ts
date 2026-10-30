import type { Types } from "effect"

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
  makeFull: (input: RenderContext): RenderContext => {
    const ctx: Types.Mutable<RenderContext> = { env: input.env }

    if (input.cluster !== undefined) ctx.cluster = input.cluster

    if (input.k8sVersion !== undefined) ctx.k8sVersion = input.k8sVersion

    if (input.flags !== undefined) ctx.flags = input.flags

    return ctx
  }
}
