import { applicationCRFilename, type AppOfAppsResult, serializeApplicationCR } from "@konfig.ts/argocd"
import {
  type AnyRenderError,
  type Bundle,
  KONFIG_HELM_CACHE_ENV,
  Manifest as M,
  type ParsedDoc,
  parseYamlAll,
  type RawYaml,
  type RenderContext,
  renderManifest,
  type ResolvedKonfigConfig,
  unsafeCoerce,
  Yaml
} from "@konfig.ts/core"
import { ConfigProvider, Data, Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { resolveCliPaths } from "./cliConfig"
import { moduleDefault } from "./moduleDefault"

export interface EnvOutDirInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
  readonly pathJoin: (...parts: string[]) => string
}
export const envOutDir = (input: EnvOutDirInput): string =>
  input.pathJoin(
    input.cfg.configDir,
    input.cfg.config.root,
    input.cfg.config.outDir.manifests,
    input.envName,
    ...(input.ctx.cluster !== undefined ? [input.ctx.cluster] : [])
  )

class EnvEntryNotFound extends Data.TaggedError("EnvEntryNotFound")<{
  readonly env: string
  readonly entry: string
}> {}

class NonManifestChild extends Data.TaggedError("NonManifestChild")<{
  readonly child: string
}> {}

class EnvLoadError extends Data.TaggedError("EnvLoadError")<{
  readonly entry: string
  readonly cause: unknown
}> {}

interface _ResolveEnvEntryInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
}
const _resolveEnvEntry = (input: _ResolveEnvEntryInput) =>
  Effect.gen(function*() {
    const { cfg, envName } = input
    const path = yield* Path
    const fs = yield* FileSystem

    const envSpec = cfg.config.envs[envName]
    const entry = envSpec === undefined
      ? path.join(cfg.configDir, cfg.config.root, "env", `${envName}.ts`)
      : path.join(cfg.configDir, cfg.config.root, envSpec.entry)

    const exists = yield* fs.exists(entry).pipe(Effect.orElseSucceed(() => false))
    if (!exists) {
      return yield* new EnvEntryNotFound({ env: envName, entry })
    }
    return entry
  })

type EnvResult = AppOfAppsResult | Bundle.BundleSetResult

const _isAppOfApps = (r: EnvResult): r is AppOfAppsResult => "apps" in r

const _loadEnv = (entry: string) =>
  Effect.gen(function*() {
    const mod = yield* Effect.tryPromise({
      try: () => import(entry),
      catch: (cause) => new EnvLoadError({ entry, cause })
    })
    const program = moduleDefault(mod)
    if (program === undefined) {
      return yield* new EnvLoadError({ entry, cause: "default export is missing" })
    }
    const isEffectProgram: boolean = Effect.isEffect(program)
    if (!isEffectProgram) {
      return yield* new EnvLoadError({
        entry,
        cause: "default export is not an Effect — env entries must default-export an AppOfApps or Bundle program Effect"
      })
    }
    const result = yield* unsafeCoerce<Effect.Effect<EnvResult, AnyRenderError>>(
      program,
      "isEffectProgram confirmed above; narrowing the proven Effect's A/E per the env entry contract"
    )
    return result
  })

interface OutputFile {
  readonly path: string
  readonly content: string
}

// Extracts just the `kind`/`metadata.name` routing fields off a parsed doc;
// excess properties are left alone (the original doc is what gets serialized).
const _KindNameSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) }))
})
const _decodeKindName = Schema.decodeUnknownOption(_KindNameSchema)

interface _SplitRawYamlInput {
  readonly content: string
  readonly dir: string
  readonly pathSep: (...parts: string[]) => string
}
const _splitRawYaml = (input: _SplitRawYamlInput): OutputFile[] => {
  const { content, dir, pathSep } = input
  const files: OutputFile[] = []
  // parseYamlAll splits on real YAML doc boundaries, not a naive /^---$/m
  // regex, so a literal `---` inside a block scalar isn't mis-split.
  for (const doc of parseYamlAll(content)) {
    if (doc === null || typeof doc !== "object") continue
    const parsed = Option.getOrUndefined(_decodeKindName(doc))
    const kind = parsed?.kind
    const name = parsed?.metadata?.name
    if (kind === undefined || name === undefined) continue
    files.push({
      path: pathSep(dir, Yaml.filenameFor({ kind, metadata: { name } })),
      content: Yaml.serialize({ value: doc })
    })
  }
  return files
}

const _isRawYaml = (v: object): v is RawYaml =>
  "_tag" in v && v._tag === "RawYaml" && "content" in v && typeof v.content === "string"

const _isParsedDoc = (v: object): v is ParsedDoc => "_tag" in v && v._tag === "ParsedDoc" && "value" in v

interface _CollectOutputsInput {
  readonly value: unknown
  readonly appDir: string
  readonly pathJoin: (...parts: string[]) => string
}
const _collectOutputs = (input: _CollectOutputsInput): OutputFile[] => {
  const { value, appDir, pathJoin } = input
  if (value === null || value === undefined) return []

  if (typeof value === "object") {
    if (_isRawYaml(value)) {
      return _splitRawYaml({ content: value.content, dir: appDir, pathSep: pathJoin })
    }
    if (_isParsedDoc(value)) {
      // Helm.release output: already parsed, so it goes straight to the
      // object branch below (one serialize, no re-parse).
      return _collectOutputs({ value: value.value, appDir, pathJoin })
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((v) => _collectOutputs({ value: v, appDir, pathJoin }))
  }

  if (typeof value === "object") {
    const parsed = Option.getOrUndefined(_decodeKindName(value))
    const kind = parsed?.kind
    const name = parsed?.metadata?.name
    if (kind !== undefined && name !== undefined) {
      return [
        {
          path: pathJoin(appDir, Yaml.filenameFor({ kind, metadata: { name } })),
          content: Yaml.serialize({ value })
        }
      ]
    }
  }

  return []
}

export interface RenderedEnv {
  readonly appsDirAbs: string
  readonly outDirAbs: string
  readonly files: ReadonlyArray<OutputFile>
}

interface EnvChildArgo {
  readonly app: AppOfAppsResult["apps"][number]
  readonly target: AppOfAppsResult["target"]
  readonly defaults: AppOfAppsResult["defaults"]
}

interface EnvChild {
  readonly name: string
  readonly manifests: ReadonlyArray<unknown>
  readonly argo: EnvChildArgo | undefined
}

const _childrenOf = (result: EnvResult): EnvChild[] =>
  _isAppOfApps(result)
    ? result.apps.map((app) => ({
      name: app.name,
      manifests: app.manifests,
      argo: { app, target: result.target, defaults: result.defaults }
    }))
    : result.bundles.map((b) => ({
      name: b.name,
      manifests: b.manifests,
      argo: undefined
    }))

interface RenderChildInput {
  readonly child: EnvChild
  readonly outDirAbs: string
  readonly appsDirAbs: string
  readonly ctx: RenderContext
  readonly path: Path
}

const _renderChild = (input: RenderChildInput) =>
  Effect.gen(function*() {
    const { appsDirAbs, child, ctx, outDirAbs, path } = input
    const appDir = path.join(outDirAbs, child.name)
    const rendered = yield* Effect.all(
      child.manifests.map((m) =>
        M.isManifest(m)
          ? renderManifest({ manifest: m, ctx })
          : Effect.die(new NonManifestChild({ child: child.name }))
      ),
      { concurrency: "unbounded" }
    )
    const out: OutputFile[] = []
    for (const value of rendered) {
      out.push(..._collectOutputs({ value, appDir, pathJoin: path.join }))
    }
    if (child.argo !== undefined) {
      out.push({
        path: path.join(appsDirAbs, applicationCRFilename(child.argo.app)),
        content: serializeApplicationCR({
          app: child.argo.app,
          target: child.argo.target,
          defaults: child.argo.defaults
        })
      })
    }
    return out
  })

export interface RenderEnvInput {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
}
const _renderEnvBody = (input: RenderEnvInput) =>
  Effect.gen(function*() {
    const { cfg, envName, ctx } = input
    const path = yield* Path
    const entry = yield* _resolveEnvEntry({ cfg, envName })
    const result = yield* _loadEnv(entry)

    const outDirAbs = envOutDir({ cfg, envName, ctx, pathJoin: path.join })
    const appsDirAbs = path.join(outDirAbs, result.name)

    const children = _childrenOf(result)

    // Bounded at 4: keeps the helm/sops subprocess count manageable.
    const perAppFiles = yield* Effect.all(
      children.map((child) => _renderChild({ appsDirAbs, child, ctx, outDirAbs, path })),
      { concurrency: 4 }
    )
    const files: OutputFile[] = perAppFiles.flat()

    const rendered: RenderedEnv = { appsDirAbs, outDirAbs, files }
    return rendered
  }).pipe(Effect.scoped)

export const renderEnv = (input: RenderEnvInput) =>
  Effect.gen(function*() {
    // Chart definitions call `Helm.release` without a `cacheDir` option — it
    // reads `Config(KONFIG_HELM_CACHE)` itself (see core's Helm.ts) at
    // manifest-render time, inside `_renderChild`/`renderManifest` below.
    // Resolving konfig.json's `helm.cacheDir` once here (same env var >
    // config > default precedence as `resolveCliPaths`, used by `crd
    // extract`/`helm fetch`) and installing it as a ConfigProvider around
    // the whole render is how that value reaches every `Helm.release()`
    // call a chart makes, without threading `cacheDir` through
    // `_loadEnv`/`_renderChild`. `ConfigProvider.orElse` keeps a real env
    // var override on top: it's tried first, only falling back to the
    // resolved value for the one KONFIG_HELM_CACHE key.
    const { cacheDir } = yield* resolveCliPaths(input.cfg)
    const helmConfigProvider = ConfigProvider.orElse(
      ConfigProvider.fromEnv(),
      ConfigProvider.fromUnknown({ [KONFIG_HELM_CACHE_ENV]: cacheDir })
    )
    return yield* _renderEnvBody(input).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, helmConfigProvider)
    )
  })

export class WriteEnvError extends Data.TaggedError("WriteEnvError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export interface WriteFilesToDirInput {
  readonly rendered: RenderedEnv
  readonly targetDir: string
}

// Re-homes `rendered.files` (keyed off `rendered.outDirAbs`) under an
// arbitrary `targetDir`, preserving the per-app layout/naming that
// `_renderChild`/`_collectOutputs` computed. Shared by `writeFiles` (staging
// dir for `konfig build`) and `konfig validate --strict` (a scratch temp dir
// so kubeconform sees the *current* render, not the last `build`'s output).
export const writeFilesToDir = (
  input: WriteFilesToDirInput
): Effect.Effect<ReadonlyArray<string>, WriteEnvError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const { rendered, targetDir } = input

    const written: string[] = []
    for (const file of rendered.files) {
      const rel = path.relative(rendered.outDirAbs, file.path)
      const targetPath = path.join(targetDir, rel)
      yield* fs
        .makeDirectory(path.dirname(targetPath), { recursive: true })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: targetPath, cause })))
      yield* fs
        .writeFileString(targetPath, file.content, { mode: 0o600 })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: targetPath, cause })))
      written.push(targetPath)
    }
    return written
  })

// Atomic write: stage all files under `<outDir>.tmp`, then remove the live
// `<outDir>` and rename `.tmp` into place — a kill mid-write never leaves a
// half-rewritten live tree.
export const writeFiles = (
  rendered: RenderedEnv
): Effect.Effect<ReadonlyArray<string>, WriteEnvError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const stagingDir = `${rendered.outDirAbs}.tmp`

    const stagingExists = yield* fs.exists(stagingDir).pipe(Effect.orElseSucceed(() => false))
    if (stagingExists) {
      yield* fs
        .remove(stagingDir, { recursive: true })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: stagingDir, cause })))
    }

    yield* writeFilesToDir({ rendered, targetDir: stagingDir })
    const written = rendered.files.map((file) => file.path)

    const liveExists = yield* fs.exists(rendered.outDirAbs).pipe(Effect.orElseSucceed(() => false))
    if (liveExists) {
      yield* fs
        .remove(rendered.outDirAbs, { recursive: true })
        .pipe(Effect.mapError((cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })))
    }
    yield* fs
      .makeDirectory(path.dirname(rendered.outDirAbs), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })
        )
      )
    yield* fs
      .rename(stagingDir, rendered.outDirAbs)
      .pipe(Effect.mapError((cause) => new WriteEnvError({ path: rendered.outDirAbs, cause })))
    return written
  })
