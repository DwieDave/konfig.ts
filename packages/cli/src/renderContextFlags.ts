import { type DiffFormat, RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect, Option } from "effect"
import { Flag } from "effect/cli"
import { resolveConfig } from "./configResolver"

export const renderContextFlags = {
  cluster: Flag.String("cluster").pipe(
    Flag.withDescription("Target cluster name (when one env spans multiple clusters)"),
    Flag.optional
  ),
  k8sVersion: Flag.String("k8s-version").pipe(
    Flag.withDescription("Target Kubernetes version (e.g. 1.31); shapes apiVersion picks"),
    Flag.optional
  ),
  flag: Flag.KeyValuePair("flag").pipe(
    Flag.withDescription("Free-form k=v flags read via ctx.flags.get(k)"),
    Flag.optional
  )
} as const

interface RenderContextFlagValues {
  readonly cluster: Option.Option<string>
  readonly k8sVersion: Option.Option<string>
  readonly flag: Option.Option<Record<string, string>>
}

interface RenderContextFromFlagsInput {
  readonly env: string
  readonly flags: RenderContextFlagValues
}

const _renderContextFromFlags = (input: RenderContextFromFlagsInput): RenderContext => {
  const flagMap = Option.match(input.flags.flag, {
    onSome: (record) => new Map<string, unknown>(Object.entries(record)),
    onNone: () => undefined
  })
  return RenderContext.makeFull({
    env: input.env,
    cluster: Option.getOrUndefined(input.flags.cluster),
    k8sVersion: Option.getOrUndefined(input.flags.k8sVersion),
    flags: flagMap
  })
}

export const formatFlag = Flag.Literals(
  "format",
  ["summary", "detail", "json"] as const satisfies readonly DiffFormat[]
)
  .pipe(
    Flag.withDescription("Output format"),
    Flag.withDefault("summary" as const)
  )

export interface WithRenderContextInput<A, E, R> {
  readonly args: RenderContextFlagValues & { readonly env: string }
  readonly run: (input: { readonly cfg: ResolvedKonfigConfig; readonly ctx: RenderContext }) => Effect.Effect<A, E, R>
}

export const withRenderContext = <A, E, R>({ args, run }: WithRenderContextInput<A, E, R>) =>
  Effect.gen(function*() {
    const cfg = yield* resolveConfig()
    return yield* run({ cfg, ctx: _renderContextFromFlags({ env: args.env, flags: args }) })
  })
