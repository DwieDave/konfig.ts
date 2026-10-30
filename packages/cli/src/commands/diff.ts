import {
  diffFiles,
  type DiffFormat,
  formatDiff,
  hasDifferences,
  type RenderContext,
  type ResolvedKonfigConfig
} from "@konfig.ts/core"
import { Console, Data, Effect } from "effect"
import { Argument, Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { renderEnv } from "../buildEnv"
import { formatFlag, renderContextFlags, withRenderContext } from "../renderContextFlags"
import { walkFiles } from "../walkFiles"

class DiffBaselineMissing extends Data.TaggedError("DiffBaselineMissing")<{
  readonly env: string
}> {}

class DiffNonEmpty extends Data.TaggedError("DiffNonEmpty")<{
  readonly env: string
}> {}

export const readBaselineDir = (baselineDir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const paths = (yield* walkFiles({ dir: baselineDir })).filter((p) => p.endsWith(".yaml"))
    const entries = yield* Effect.forEach(paths, (full) =>
      fs.readFileString(full).pipe(
        Effect.orElseSucceed(() => ""),
        Effect.map((content) => [path.relative(baselineDir, full), content] as const)
      ))
    return Object.fromEntries(entries)
  })

interface RunDiffInput {
  readonly args: { readonly env: string; readonly format: DiffFormat }
  readonly cfg: ResolvedKonfigConfig
  readonly ctx: RenderContext
}

const _runDiff = ({ args, cfg, ctx }: RunDiffInput) =>
  Effect.gen(function*() {
    const path = yield* Path
    if (cfg.config.diff === undefined) {
      return yield* new DiffBaselineMissing({ env: args.env })
    }
    const rendered = yield* renderEnv({ cfg, envName: args.env, ctx })
    const baselineDirAbs = path.join(cfg.configDir, cfg.config.root, cfg.config.diff.baseline, args.env)
    const left = yield* readBaselineDir(baselineDirAbs)
    const right = Object.fromEntries(
      rendered.files.map((file) => [path.relative(rendered.outDirAbs, file.path), file.content])
    )
    const result = diffFiles({ left, right })
    if (hasDifferences(result)) {
      yield* Console.log(formatDiff({ result, format: args.format }))
      return yield* new DiffNonEmpty({ env: args.env })
    }
    yield* Console.log(`OK — env '${args.env}' matches baseline`)
  })

export const diffCommand = Command.make(
  "diff",
  {
    env: Argument.String("env").pipe(Argument.withDescription("Env to diff")),
    format: formatFlag,
    ...renderContextFlags
  },
  (args) => withRenderContext({ args, run: ({ cfg, ctx }) => _runDiff({ args, cfg, ctx }) })
).pipe(Command.withDescription("Structural diff vs the nixidy baseline"))
