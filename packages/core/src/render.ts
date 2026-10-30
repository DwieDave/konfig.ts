import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Array as Arr, Effect, Layer, Predicate } from "effect"
import { unsafeCoerce } from "./_cast"
import type * as Manifest from "./Manifest"
import { RenderContext } from "./RenderContext"
import type { AnyRenderError } from "./RenderError"
import { unwrapDocs } from "./unwrapDocs"
import * as Yaml from "./yaml"

export interface RenderOptions<RIn = never, E = never> {
  readonly env?: string
  readonly layers?: Layer.Layer<RIn, never, never>
  // Defaults to NodeRuntime.runMain; override in tests to avoid exiting the process.
  readonly runMain?: (effect: Effect.Effect<void, E>) => void
}

export const _resolveEnv = (env: string | undefined): string => env ?? "prod"

export const _buildLayers = <RIn>(
  extra: Layer.Layer<RIn, never, never> | undefined
): Layer.Layer<NodeServices.NodeServices | RIn, never, never> =>
  extra === undefined
    ? unsafeCoerce<Layer.Layer<NodeServices.NodeServices | RIn, never, never>>(
      NodeServices.layer,
      "no extra layers given means RIn is never at the call site; Layer is contravariant in its output so the generic form cannot be proven"
    )
    : Layer.mergeAll(NodeServices.layer, extra)

// Extracted so tests can exercise this with Effect.runPromise instead of runMain (which exits).
// oxlint-disable-next-line app/no-multiple-function-params
export const _compose = <E, RIn>(
  program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices.NodeServices | RIn>,
  options: RenderOptions<RIn> = {}
): Effect.Effect<void, E> => {
  const ctx = RenderContext.make(_resolveEnv(options.env))
  const layers = _buildLayers(options.layers)

  return program(ctx).pipe(Effect.scoped, Effect.provide(layers))
}

// oxlint-disable-next-line app/no-multiple-function-params
export const render = <E, RIn>(
  program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices.NodeServices | RIn>,
  options: RenderOptions<RIn, E> = {}
): void => {
  const runMain = options.runMain ?? NodeRuntime.runMain
  runMain(_compose(program, options))
}

interface RenderAllYamlEffectInput {
  // Defaults to RenderContext.make("prod").
  readonly ctx?: RenderContext
  readonly manifests: ReadonlyArray<Manifest.Manifest<unknown>>
}

// Renders every manifest in order, flattens tuple results (Workload.web renders
// to [Deployment, Service]) and joins the documents into one multi-doc YAML string.
export const renderAllYamlEffect = (
  input: RenderAllYamlEffectInput
): Effect.Effect<string, AnyRenderError, Manifest.RenderServices> =>
  Effect.gen(function*() {
    const ctx = input.ctx ?? RenderContext.make(_resolveEnv(undefined))
    const rendered = yield* Effect.forEach(input.manifests, (m) => m.render(ctx))
    const groups = yield* Effect.forEach(rendered.flatMap((r) => Arr.ensure(r)), unwrapDocs)

    return groups
      .flat()
      .filter(Predicate.isNotNullish)
      .map((doc) => Yaml.serialize({ value: doc }))
      .join("---\n")
  })

export interface RenderAllYamlInput {
  readonly env?: string
  readonly manifests: ReadonlyArray<Manifest.Manifest<unknown>>
}

// Promise variant for scripts: provides NodeServices and a scope internally.
export const renderAllYaml = (input: RenderAllYamlInput): Promise<string> =>
  Effect.runPromise(
    renderAllYamlEffect({ ctx: RenderContext.make(_resolveEnv(input.env)), manifests: input.manifests }).pipe(
      Effect.scoped,
      Effect.provide(NodeServices.layer)
    )
  )
