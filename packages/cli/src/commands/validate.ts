import type { RenderContext, ResolvedKonfigConfig } from "@konfig.ts/core"
import { Console, Data, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { renderEnv, writeFilesToDir } from "../buildEnv"
import { renderContextFlags, withRenderContext } from "../renderContextFlags"
import { runKubeconform, validateManifestFile, type ValidationIssue } from "../validator"

export class StructuralValidationFailed extends Data.TaggedError("StructuralValidationFailed")<{
  readonly env: string
  readonly issueCount: number
}> {}

export interface RunValidateInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
  readonly strict: boolean
  readonly ignoreMissingSchemas: boolean
}

type Rendered = Effect.Success<ReturnType<typeof renderEnv>>

const _structuralIssues = (rendered: Rendered) =>
  Effect.forEach(
    rendered.files,
    (f) => validateManifestFile({ file: f.path, content: f.content }),
    { concurrency: "unbounded" }
  ).pipe(Effect.map((all) => all.flat()))

const _failOnIssues = (input: {
  readonly envName: string
  readonly issues: ReadonlyArray<ValidationIssue>
}) =>
  Effect.gen(function*() {
    for (const issue of input.issues) {
      yield* Console.error(`${issue.file} (doc ${issue.doc}) ${issue.path.join(".")}: ${issue.message}`)
    }
    return yield* new StructuralValidationFailed({ env: input.envName, issueCount: input.issues.length })
  })

const _kubeconformArgs = (input: Pick<RunValidateInput, "ctx" | "ignoreMissingSchemas">): string[] => [
  ...(input.ignoreMissingSchemas ? ["-ignore-missing-schemas"] : []),
  ...(input.ctx.k8sVersion !== undefined ? ["-kubernetes-version", input.ctx.k8sVersion] : [])
]

const _runStrict = (input: RunValidateInput & { readonly rendered: Rendered }) =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const scratchDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-validate-" })
      yield* writeFilesToDir({ rendered: input.rendered, targetDir: scratchDir })
      yield* Console.log(`Running kubeconform -strict against ${scratchDir}...`)
      yield* runKubeconform({ dir: scratchDir, extraArgs: _kubeconformArgs(input) })
      yield* Console.log(`kubeconform: OK`)
    })
  )

export const runValidate = (input: RunValidateInput) =>
  Effect.gen(function*() {
    const { cfg, ctx, envName } = input
    const rendered = yield* renderEnv({ cfg, envName, ctx })
    const issues = yield* _structuralIssues(rendered)
    if (issues.length > 0) return yield* _failOnIssues({ envName, issues })
    yield* Console.log(`OK — env '${envName}': ${rendered.files.length} file(s) pass structural validation`)
    if (input.strict) yield* _runStrict({ ...input, rendered })
  })

export const validateCommand = Command.make(
  "validate",
  {
    env: Argument.String("env").pipe(Argument.withDescription("Env name to validate")),
    strict: Flag.Boolean("strict").pipe(
      Flag.withDescription(
        "Additionally run kubeconform -strict over the rendered manifests (requires kubeconform on PATH)"
      ),
      Flag.withDefault(false)
    ),
    ignoreMissingSchemas: Flag.Boolean("ignore-missing-schemas").pipe(
      Flag.withDescription(
        "Pass --ignore-missing-schemas to kubeconform (useful for CRDs the bundled schema set doesn't know)"
      ),
      Flag.withDefault(false)
    ),
    ...renderContextFlags
  },
  (args) =>
    withRenderContext({
      args,
      run: ({ cfg, ctx }) =>
        runValidate({
          cfg,
          envName: args.env,
          ctx,
          strict: args.strict,
          ignoreMissingSchemas: args.ignoreMissingSchemas
        })
    })
).pipe(
  Command.withDescription(
    "Render + structural validation. --strict additionally invokes kubeconform."
  )
)
