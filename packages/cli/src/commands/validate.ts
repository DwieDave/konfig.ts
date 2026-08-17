import type { RenderContext, ResolvedKonfigConfig } from "@konfig.ts/core"
import { Console, Data, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Argument, Command, Flag } from "../_unstable"
import { renderEnv, writeFilesToDir } from "../buildEnv"
import { resolveConfig } from "../configResolver"
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags"
import { runKubeconform, validateManifestFile } from "../validator"

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

export const runValidate = (input: RunValidateInput) =>
  Effect.gen(function*() {
    const { cfg, ctx, envName, ignoreMissingSchemas, strict } = input
    const rendered = yield* renderEnv({ cfg, envName, ctx })

    const allIssues = yield* Effect.all(
      rendered.files.map((f) => validateManifestFile({ file: f.path, content: f.content })),
      { concurrency: "unbounded" }
    )
    const issues = allIssues.flat()
    if (issues.length > 0) {
      for (const issue of issues) {
        yield* Console.error(
          `${issue.file} (doc ${issue.doc}) ${issue.path.join(".")}: ${issue.message}`
        )
      }
      return yield* new StructuralValidationFailed({
        env: envName,
        issueCount: issues.length
      })
    }

    yield* Console.log(
      `OK — env '${envName}': ${rendered.files.length} file(s) pass structural validation`
    )

    if (strict) {
      yield* Effect.scoped(
        Effect.gen(function*() {
          const fs = yield* FileSystem
          // kubeconform must see the render this invocation just produced,
          // not the on-disk output of a previous `konfig build` — so stage
          // it into a scratch temp dir instead of pointing at rendered.outDirAbs.
          const scratchDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-validate-" })
          yield* writeFilesToDir({ rendered, targetDir: scratchDir })

          yield* Console.log(`Running kubeconform -strict against ${scratchDir}...`)
          const extraArgs = [
            ...(ignoreMissingSchemas ? ["-ignore-missing-schemas"] : []),
            ...(ctx.k8sVersion !== undefined ? ["-kubernetes-version", ctx.k8sVersion] : [])
          ]
          yield* runKubeconform({ dir: scratchDir, extraArgs })
          yield* Console.log(`kubeconform: OK`)
        })
      )
    }
  })

export const validateCommand = Command.make(
  "validate",
  {
    env: Argument.string("env").pipe(Argument.withDescription("Env name to validate")),
    strict: Flag.boolean("strict").pipe(
      Flag.withDescription(
        "Additionally run kubeconform -strict over the rendered manifests (requires kubeconform on PATH)"
      ),
      Flag.withDefault(false)
    ),
    ignoreMissingSchemas: Flag.boolean("ignore-missing-schemas").pipe(
      Flag.withDescription(
        "Pass --ignore-missing-schemas to kubeconform (useful for CRDs the bundled schema set doesn't know)"
      ),
      Flag.withDefault(false)
    ),
    ...renderContextFlags
  },
  (args) =>
    Effect.gen(function*() {
      const cfg = yield* resolveConfig()
      const ctx = renderContextFromFlags({ env: args.env, flags: args })
      return yield* runValidate({
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
