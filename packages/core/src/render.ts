import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { parseYamlAll } from "./diff"
import type * as Manifest from "./Manifest"
import { RenderContext } from "./RenderContext"
import type { AnyRenderError } from "./RenderError"
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
    // oxlint-disable-next-line app/no-type-assertion
    ? (NodeServices.layer as Layer.Layer<NodeServices.NodeServices | RIn, never, never>)
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

const _flatten = (rendered: unknown): ReadonlyArray<unknown> => Array.isArray(rendered) ? rendered : [rendered]

// Helm.release yields ParsedDoc wrappers and Manifest.embedYaml a RawYaml one;
// unwrap both so the output is the documents, not the wrapper objects.
const _unwrapDocs = (doc: unknown): ReadonlyArray<unknown> => {
  if (doc === null || typeof doc !== "object" || !("_tag" in doc)) return [doc]
  if (doc._tag === "ParsedDoc" && "value" in doc) return [doc.value]
  if (doc._tag === "RawYaml" && "content" in doc && typeof doc.content === "string") return parseYamlAll(doc.content)
  return [doc]
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
    const docs: Array<string> = []
    for (const m of input.manifests) {
      const rendered = yield* m.render(ctx)
      for (const doc of _flatten(rendered).flatMap(_unwrapDocs)) {
        docs.push(Yaml.serialize({ value: doc }))
      }
    }
    return docs.join("---\n")
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
