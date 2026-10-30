import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { flattenDocs } from "./flattenDocs"
import type * as Manifest from "./Manifest"
import { RenderContext } from "./RenderContext"
import type { AnyRenderError } from "./RenderError"
import * as Yaml from "./yaml"

const _resolveEnv = (env: string | undefined): string => env ?? "prod"

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
