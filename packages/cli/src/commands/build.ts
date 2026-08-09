import type { RenderContext, ResolvedKonfigConfig } from "@konfig.ts/core"
import { Clock, Console, DateTime, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Argument, Command, Flag } from "../_unstable"
import {
  computeInputHash,
  computeOnDiskOutputHash,
  computeOutputHash,
  readCacheEntry,
  writeCacheEntry
} from "../buildCache"
import { envOutDir, renderEnv, writeFiles } from "../buildEnv"
import { resolveConfig } from "../configResolver"
import { renderContextFlags, renderContextFromFlags } from "../renderContextFlags"

const _formatReport = (
  envName: string,
  timing: {
    renderMs: number
    writeMs: number
    files: number
    outDir: string
    cached?: boolean
  },
  logFmt: "text" | "json"
): string => {
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

export interface RunBuildInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
  readonly logFmt: "text" | "json"
  readonly verbose: boolean
  readonly noCache: boolean
}

export const runBuild = (input: RunBuildInput) =>
  Effect.gen(function*() {
    const { cfg, ctx, envName, logFmt, noCache, verbose } = input
    const fs = yield* FileSystem

    const path = yield* Path
    const ctxOutDir = envOutDir({ cfg, envName, ctx, pathJoin: path.join })

    let cachedInputHash: string | undefined
    if (!noCache) {
      const inputHash = yield* computeInputHash({ cfg, envName, ctx })
      cachedInputHash = inputHash
      const entry = yield* readCacheEntry({ cfg, envName, ctx })
      if (
        entry !== undefined &&
        entry.inputHash === inputHash &&
        entry.outDirAbs === ctxOutDir
      ) {
        const outDirExists = yield* fs
          .exists(entry.outDirAbs)
          .pipe(Effect.orElseSucceed(() => false))
        // Honor the hit only if the on-disk tree still hashes to the
        // recorded outputHash — an out-of-band edit/delete is a miss.
        const onDiskHash = outDirExists
          ? yield* computeOnDiskOutputHash(entry.outDirAbs)
          : undefined
        if (outDirExists && onDiskHash === entry.outputHash) {
          yield* Console.log(
            _formatReport(
              envName,
              {
                renderMs: 0,
                writeMs: 0,
                files: entry.fileCount,
                outDir: entry.outDirAbs,
                cached: true
              },
              logFmt
            )
          )
          return
        }
      }
    }

    if (logFmt === "text") {
      yield* Console.log(`Rendering env '${envName}'...`)
    }

    const renderStart = yield* Clock.currentTimeMillis
    const renderProgram = renderEnv({ cfg, envName, ctx })
    const rendered = yield* (verbose
      ? renderProgram.pipe(Effect.withSpan(`konfig.render.${envName}`))
      : renderProgram)
    const renderMs = (yield* Clock.currentTimeMillis) - renderStart

    const writeStart = yield* Clock.currentTimeMillis
    const written = yield* writeFiles(rendered)
    const writeMs = (yield* Clock.currentTimeMillis) - writeStart

    if (!noCache && cachedInputHash !== undefined) {
      const outputHash = computeOutputHash(rendered.files)
      const timestamp = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
      yield* writeCacheEntry({
        cfg,
        envName,
        ctx,
        entry: {
          inputHash: cachedInputHash,
          outputHash,
          outDirAbs: rendered.outDirAbs,
          fileCount: written.length,
          timestamp
        }
      })
    }

    yield* Console.log(
      _formatReport(
        envName,
        {
          renderMs,
          writeMs,
          files: written.length,
          outDir: rendered.outDirAbs
        },
        logFmt
      )
    )
  })

export const buildCommand = Command.make(
  "build",
  {
    env: Argument.string("env").pipe(Argument.withDescription("Env name to build (e.g. prod)")),
    log: Flag.choice("log", ["text", "json"] as const).pipe(
      Flag.withDescription("Output format for log lines"),
      Flag.withDefault("text" as const)
    ),
    verbose: Flag.boolean("verbose").pipe(
      Flag.withDescription("Enable Effect tracing for the render program"),
      Flag.withDefault(false)
    ),
    noCache: Flag.boolean("no-cache").pipe(
      Flag.withDescription(
        "Skip the input-hash check and force a fresh render (debug / first-build use)."
      ),
      Flag.withDefault(false)
    ),
    ...renderContextFlags
  },
  (args) =>
    Effect.gen(function*() {
      const cfg = yield* resolveConfig()
      const ctx = renderContextFromFlags({ env: args.env, flags: args })
      return yield* runBuild({
        cfg,
        envName: args.env,
        ctx,
        logFmt: args.log,
        verbose: args.verbose,
        noCache: args.noCache
      })
    })
).pipe(Command.withDescription("Render manifests for an env"))
