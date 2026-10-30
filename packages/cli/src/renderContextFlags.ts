import { type DiffFormat, RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Data, Effect, Option, Schema } from "effect"
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

export const _clusterName = Schema.String.check(Schema.isPattern(/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/))

export const _envName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]*$/))

const _K8S_VERSION = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/

class InvalidK8sVersion extends Data.TaggedError("InvalidK8sVersion")<{
  readonly value: string
}> {
  get message(): string {
    return `--k8s-version '${this.value}' must look like 1.31, 1.31.2 or v1.31.2`
  }
}

export const _toKubeconformVersion = (version: string): string =>
  Option.match(Option.fromNullishOr(_K8S_VERSION.exec(version)), {
    onNone: () => version,
    onSome: ([, major, minor, patch]) => `${major}.${minor}.${patch ?? "0"}`
  })

export const _checkK8sVersion = (value: string): Effect.Effect<string, InvalidK8sVersion> =>
  _K8S_VERSION.test(value) ? Effect.succeed(value) : Effect.fail(new InvalidK8sVersion({ value }))

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

interface WithRenderContextInput<A, E, R> {
  readonly args: RenderContextFlagValues & { readonly env: string }
  readonly run: (input: { readonly cfg: ResolvedKonfigConfig; readonly ctx: RenderContext }) => Effect.Effect<A, E, R>
}

export const _decodeFlags = (args: WithRenderContextInput<never, never, never>["args"]) =>
  Effect.gen(function*() {
    const env = yield* Schema.decodeEffect(_envName)(args.env)

    const cluster = yield* Schema.decodeEffect(Schema.Option(_clusterName))(args.cluster)

    yield* Effect.forEach(Option.toArray(args.k8sVersion), _checkK8sVersion)

    return { ...args, env, cluster }
  })

export const withRenderContext = <A, E, R>({ args, run }: WithRenderContextInput<A, E, R>) =>
  Effect.gen(function*() {
    const decoded = yield* _decodeFlags(args)
    const cfg = yield* resolveConfig()

    return yield* run({ cfg, ctx: _renderContextFromFlags({ env: decoded.env, flags: decoded }) })
  })
