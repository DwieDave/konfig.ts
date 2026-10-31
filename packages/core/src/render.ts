import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { unsafeCoerce } from "./_cast"
import { flattenDocs } from "./flattenDocs"
import type * as Manifest from "./Manifest"
import { RenderContext } from "./RenderContext"
import type { AnyRenderError } from "./RenderError"
import * as Yaml from "./yaml"

const _resolveEnv = (env: string | undefined): string => env ?? "prod"

export interface RenderOptions<RIn = never, E = never> {
  readonly env?: string
  readonly layers?: Layer.Layer<RIn, never, never>
  // Defaults to NodeRuntime.runMain; override in tests to avoid exiting the process.
  readonly runMain?: (effect: Effect.Effect<void, E>) => void
}

type RenderProgram<E, RIn> = (ctx: RenderContext) => Effect.Effect<void, E, NodeServices.NodeServices | RIn>

interface RenderInput<E, RIn> {
  readonly program: RenderProgram<E, RIn>
  readonly options?: RenderOptions<RIn, E>
}

export const _buildLayers = <RIn>(
  extra: Layer.Layer<RIn, never, never> | undefined
): Layer.Layer<NodeServices.NodeServices | RIn, never, never> =>
  extra === undefined
    ? unsafeCoerce<Layer.Layer<NodeServices.NodeServices | RIn, never, never>>({
      value: NodeServices.layer,
      reason:
        "no extra layers given means RIn is never at the call site; Layer is contravariant in its output so the generic form cannot be proven"
    })
    : Layer.mergeAll(NodeServices.layer, extra)

// Split from `render` so tests can run the composed Effect instead of runMain (which exits).
export const _compose = <E, RIn>(input: RenderInput<E, RIn>): Effect.Effect<void, E> => {
  const options = input.options ?? {}
  const ctx = RenderContext.make(_resolveEnv(options.env))

  return input.program(ctx).pipe(Effect.scoped, Effect.provide(_buildLayers(options.layers)))
}

// Runs a script-style program: a ctx for `env` (default "prod"), Node services plus any
// extra `layers`, a scope, and the Node runtime (or the `runMain` override).
export const render = <E, RIn>(input: RenderInput<E, RIn>): void => {
  const runMain = input.options?.runMain ?? NodeRuntime.runMain
  runMain(_compose(input))
}

export interface RenderAllYamlEffectInput {
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
    const docs = yield* flattenDocs(rendered)

    return docs
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
