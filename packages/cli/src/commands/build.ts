import { Clock, Console, DateTime, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import {
  computeInputHash,
  computeOnDiskOutputHash,
  computeOutputHash,
  readCacheEntry,
  writeCacheEntry
} from "../buildCache"
import { envOutDir, type EnvTarget, type RenderedEnv, renderEnv, writeFiles } from "../buildEnv"
import { existsOrFalse } from "../fsUtil"
import { renderContextFlags, withRenderContext } from "../renderContextFlags"

interface Timing {
  readonly renderMs: number
  readonly writeMs: number
  readonly files: number
  readonly outDir: string
  readonly cached?: boolean
}

type LogFormat = "text" | "json"

const _formatReport = (input: {
  readonly envName: string
  readonly timing: Timing
  readonly logFmt: LogFormat
}): string => {
  const { envName, timing, logFmt } = input

  if (logFmt === "json") {
    return JSON.stringify({
      env: envName,
      files: timing.files,
      outDir: timing.outDir,
      renderMs: timing.renderMs,
      writeMs: timing.writeMs,
      totalMs: timing.renderMs + timing.writeMs,
      cached: timing.cached ?? false
    })
  }

  if (timing.cached) {
    return `Cached — env '${envName}' inputs unchanged, ${timing.files} file(s) at ${timing.outDir}`
  }

  return `Wrote ${timing.files} file(s) to ${timing.outDir} — render ${timing.renderMs}ms, write ${timing.writeMs}ms`
}

interface RunBuildInput extends EnvTarget {
  readonly logFmt: LogFormat
  readonly noCache: boolean
}

const _validCacheHit = (input: EnvTarget & { readonly inputHash: string; readonly outDir: string }) =>
  Effect.gen(function*() {
    const entry = yield* readCacheEntry(input)

    if (entry === undefined || entry.inputHash !== input.inputHash || entry.outDirAbs !== input.outDir) {
      return undefined
    }

    if (!(yield* existsOrFalse(entry.outDirAbs))) return undefined
    const onDiskHash = yield* computeOnDiskOutputHash(entry.outDirAbs)

    return onDiskHash === entry.outputHash ? entry : undefined
  })

const _timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const start = yield* Clock.currentTimeMillis
    const value = yield* effect

    return { value, ms: (yield* Clock.currentTimeMillis) - start }
  })

const _persistCacheEntry = (
  input: EnvTarget & {
    readonly inputHash: string
    readonly rendered: RenderedEnv
    readonly fileCount: number
  }
) =>
  Effect.gen(function*() {
    const timestamp = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
    yield* writeCacheEntry({
      cfg: input.cfg,
      envName: input.envName,
      ctx: input.ctx,
      entry: {
        inputHash: input.inputHash,
        outputHash: computeOutputHash(input.rendered.files),
        outDirAbs: input.rendered.outDirAbs,
        fileCount: input.fileCount,
        timestamp
      }
    })
  })

const _renderAndWrite = (input: RunBuildInput) => {
  const program = renderEnv(input)

  return Effect.gen(function*() {
    const render = yield* _timed(program)
    const write = yield* _timed(writeFiles({ rendered: render.value, cfg: input.cfg }))

    return { rendered: render.value, written: write.value, renderMs: render.ms, writeMs: write.ms }
  })
}

const _buildFresh = (input: RunBuildInput & { readonly inputHash: string | undefined }) =>
  Effect.gen(function*() {
    if (input.logFmt === "text") yield* Console.log(`Rendering env '${input.envName}'...`)
    const { rendered, written, renderMs, writeMs } = yield* _renderAndWrite(input)

    if (input.inputHash !== undefined) {
      yield* _persistCacheEntry({ ...input, inputHash: input.inputHash, rendered, fileCount: written.length })
    }

    const timing = { renderMs, writeMs, files: written.length, outDir: rendered.outDirAbs }
    yield* Console.log(_formatReport({ envName: input.envName, timing, logFmt: input.logFmt }))
  })

const _reportCached = (input: RunBuildInput & { readonly fileCount: number; readonly outDir: string }) =>
  Console.log(_formatReport({
    envName: input.envName,
    timing: { renderMs: 0, writeMs: 0, files: input.fileCount, outDir: input.outDir, cached: true },
    logFmt: input.logFmt
  }))

export const runBuild = (input: RunBuildInput) =>
  Effect.gen(function*() {
    const outDir = yield* envOutDir(input)

    if (input.noCache) return yield* _buildFresh({ ...input, inputHash: undefined })
    const inputHash = yield* computeInputHash(input)
    const hit = yield* _validCacheHit({ ...input, inputHash, outDir })

    if (hit !== undefined) return yield* _reportCached({ ...input, fileCount: hit.fileCount, outDir: hit.outDirAbs })

    return yield* _buildFresh({ ...input, inputHash })
  })

export const buildCommand = Command.make(
  "build",
  {
    env: Argument.String("env").pipe(Argument.withDescription("Env name to build (e.g. prod)")),
    log: Flag.Literals("log", ["text", "json"] as const).pipe(
      Flag.withDescription("Output format for log lines"),
      Flag.withDefault("text" as const)
    ),
    noCache: Flag.Boolean("no-cache").pipe(
      Flag.withDescription(
        "Skip the input-hash check and force a fresh render (debug / first-build use)."
      ),
      Flag.withDefault(false)
    ),
    ...renderContextFlags
  },
  (args) =>
    withRenderContext({
      args,
      run: ({ cfg, ctx }) =>
        runBuild({
          cfg,
          envName: args.env,
          ctx,
          logFmt: args.log,
          noCache: args.noCache
        })
    })
).pipe(Command.withDescription("Render manifests for an env"))
