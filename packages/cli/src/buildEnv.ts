import { applicationCRFilename, type AppOfAppsResult, serializeApplicationCR } from "@konfig.ts/argocd"
import {
  type AnyRenderError,
  existsOrFalse,
  isParsedDoc,
  isRawYaml,
  KONFIG_HELM_CACHE_ENV,
  Manifest as M,
  type RenderContext,
  renderManifest,
  type ResolvedKonfigConfig,
  unwrapDocs,
  Yaml
} from "@konfig.ts/core"
import { Array as Arr, ConfigProvider, Data, Effect, Option, Predicate, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { resolveCliPaths } from "./cliConfig"
import { envEntryPath } from "./envEntry"
import { decodeEnvResult, type EnvResult } from "./envResult"
import { moduleDefault } from "./moduleDefault"

export interface EnvTarget {
  readonly cfg: ResolvedKonfigConfig
  readonly envName: string
  readonly ctx: RenderContext
}

export const envDirName = (input: Pick<EnvTarget, "envName" | "ctx">): string =>
  input.ctx.cluster === undefined ? input.envName : `${input.envName}@${input.ctx.cluster}`

const _manifestsRoot = (cfg: ResolvedKonfigConfig) =>
  Effect.gen(function*() {
    const path = yield* Path

    return path.join(cfg.configDir, cfg.config.root, cfg.config.outDir.manifests)
  })

export const envOutDir = (target: EnvTarget) =>
  Effect.gen(function*() {
    const path = yield* Path

    return path.join(yield* _manifestsRoot(target.cfg), envDirName(target))
  })

class EnvEntryNotFound extends Data.TaggedError("EnvEntryNotFound")<{
  readonly env: string
  readonly entry: string
}> {}

class NonManifestChild extends Data.TaggedError("NonManifestChild")<{
  readonly child: string
}> {
  get message(): string {
    return `child '${this.child}' lists a manifest that was not built with Manifest.make`
  }
}

class OutDirOutsideManifests extends Data.TaggedError("OutDirOutsideManifests")<{
  readonly outDir: string
  readonly root: string
}> {
  get message(): string {
    return `refusing to replace ${this.outDir}: it is not strictly inside the manifests root ${this.root}`
  }
}

class UnsafeOutputPath extends Data.TaggedError("UnsafeOutputPath")<{
  readonly path: string
  readonly root: string
}> {
  get message(): string {
    return `refusing to write ${this.path}: it is not strictly inside ${this.root}`
  }
}

class EnvResultInvalid extends Data.TaggedError("EnvResultInvalid")<{
  readonly entry: string
  readonly cause: unknown
}> {
  get message(): string {
    return `env entry ${this.entry} produced a result of the wrong shape: ${String(this.cause)}`
  }
}

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
    const entry = yield* envEntryPath({ cfg, envName })

    if (!(yield* existsOrFalse(entry))) {
      return yield* new EnvEntryNotFound({ env: envName, entry })
    }

    return entry
  })

const _isAppOfApps = (r: EnvResult): r is AppOfAppsResult => "apps" in r

const _importDefault = (entry: string): Effect.Effect<unknown, EnvLoadError> =>
  Effect.gen(function*() {
    const mod = yield* Effect.tryPromise({
      try: () => import(entry),
      catch: (cause) => new EnvLoadError({ entry, cause })
    })

    const program = moduleDefault(mod)

    return program === undefined ? yield* new EnvLoadError({ entry, cause: "default export is missing" }) : program
  })

const _NOT_AN_EFFECT =
  "default export is not an Effect — env entries must default-export an AppOfApps or Bundle program Effect"

const _isEnvProgram = (program: unknown): program is Effect.Effect<unknown, AnyRenderError> => Effect.isEffect(program)

const _asEnvProgram = (input: { readonly entry: string; readonly program: unknown }) =>
  _isEnvProgram(input.program)
    ? Effect.succeed(input.program)
    : Effect.fail(new EnvLoadError({ entry: input.entry, cause: _NOT_AN_EFFECT }))

const _loadEnv = (entry: string) =>
  Effect.gen(function*() {
    const program = yield* _asEnvProgram({ entry, program: yield* _importDefault(entry) })
    const result = yield* program

    return yield* decodeEnvResult(result).pipe(
      Effect.mapError((cause) => new EnvResultInvalid({ entry, cause }))
    )
  })

interface OutputFile {
  readonly path: string
  readonly content: string
  readonly object?: string
}

class InvalidOutputObject extends Data.TaggedError("InvalidOutputObject")<{
  readonly kind: string
  readonly objectName: string
  readonly dir: string
}> {
  get message(): string {
    return `rendered object in ${this.dir} has a missing or empty kind ('${this.kind}') or metadata.name ('${this.objectName}')`
  }
}

const _KindNameSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.String), namespace: Schema.optional(Schema.String) })
  )
})

const _decodeKindName = Schema.decodeUnknownOption(_KindNameSchema)

interface Routing {
  readonly kind: string
  readonly name: string
  readonly namespace: string | undefined
}

const _UNROUTABLE: Routing = { kind: "", name: "", namespace: undefined }

const _routingOf = (decoded: Option.Option<typeof _KindNameSchema.Type>): Routing =>
  Option.match(decoded, {
    onNone: () => _UNROUTABLE,
    onSome: (parsed) => ({
      kind: parsed.kind ?? "",
      name: parsed.metadata?.name ?? "",
      namespace: parsed.metadata?.namespace
    })
  })

const _describeObject = (routing: Routing): string =>
  `${routing.kind} ${routing.namespace === undefined ? "" : `${routing.namespace}/`}${routing.name}`

interface _ToOutputFileInput {
  readonly doc: unknown
  readonly routing: Routing
  readonly dir: string
}

const _toOutputFile = (input: _ToOutputFileInput): Effect.Effect<OutputFile, InvalidOutputObject, Path> =>
  Effect.gen(function*() {
    const path = yield* Path
    const { dir, doc, routing } = input

    if (routing.kind === "" || routing.name === "") {
      return yield* new InvalidOutputObject({ kind: routing.kind, objectName: routing.name, dir })
    }

    return {
      path: path.join(dir, Yaml.filenameFor({ kind: routing.kind, metadata: { name: routing.name } })),
      content: Yaml.serialize({ value: doc }),
      object: _describeObject(routing)
    }
  })

interface _CollectOutputsInput {
  readonly value: unknown
  readonly appDir: string
}

type _UnwrapError = Effect.Error<ReturnType<typeof unwrapDocs>>

export const _collectOutputs = (
  input: _CollectOutputsInput
): Effect.Effect<OutputFile[], InvalidOutputObject | _UnwrapError, Path> => {
  const { appDir, value } = input

  const flatten = (values: ReadonlyArray<unknown>) =>
    Effect.forEach(values, (v) => _collectOutputs({ value: v, appDir })).pipe(Effect.map((groups) => groups.flat()))

  if (Array.isArray(value)) return flatten(value)

  if (isRawYaml(value) || isParsedDoc(value)) return unwrapDocs(value).pipe(Effect.flatMap(flatten))

  if (value === null || value === undefined) return Effect.succeed([])

  if (!Predicate.isObject(value)) {
    return Effect.fail(
      new InvalidOutputObject({ kind: "non-object value", objectName: JSON.stringify(value), dir: appDir })
    )
  }

  return Effect.map(
    _toOutputFile({ doc: value, dir: appDir, routing: _routingOf(_decodeKindName(value)) }),
    (file) => [file]
  )
}

interface OutputCollision {
  readonly path: string
  readonly objects: ReadonlyArray<string>
}

class OutputFileCollision extends Data.TaggedError("OutputFileCollision")<{
  readonly collisions: ReadonlyArray<OutputCollision>
}> {
  get message(): string {
    const lines = this.collisions.map((c) => `  ${c.path}: ${c.objects.join(" vs ")}`)

    return `distinct rendered objects map to the same output file:\n${lines.join("\n")}`
  }
}

export const _findOutputCollisions = (files: ReadonlyArray<OutputFile>): OutputCollision[] =>
  Object.entries(Arr.groupBy(files, (f) => f.path)).flatMap(([path, group]) =>
    Arr.dedupe(group.map((f) => f.content)).length > 1
      ? [{ path, objects: group.map((f) => f.object ?? "(unnamed document)") }]
      : []
  )

const _failOnCollisions = (files: ReadonlyArray<OutputFile>) => {
  const collisions = _findOutputCollisions(files)

  return collisions.length === 0 ? Effect.void : Effect.fail(new OutputFileCollision({ collisions }))
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
}

const _renderManifests = (input: Pick<RenderChildInput, "child" | "ctx">) =>
  Effect.forEach(
    input.child.manifests,
    (m) =>
      Effect.gen(function*() {
        if (!M.isManifest(m)) return yield* new NonManifestChild({ child: input.child.name })

        return yield* renderManifest({ manifest: m, ctx: input.ctx })
      }),
    { concurrency: "unbounded" }
  )

const _applicationFile = (input: { readonly argo: EnvChildArgo; readonly appsDirAbs: string }) =>
  Effect.gen(function*() {
    const path = yield* Path
    const { app, defaults, target } = input.argo

    return {
      path: path.join(input.appsDirAbs, applicationCRFilename(app)),
      content: serializeApplicationCR({ app, target, defaults })
    } satisfies OutputFile
  })

const _renderChild = (input: RenderChildInput) =>
  Effect.gen(function*() {
    const { appsDirAbs, child, ctx, outDirAbs } = input
    const path = yield* Path
    const appDir = path.join(outDirAbs, child.name)
    const rendered = yield* _renderManifests({ child, ctx })
    const collected = yield* Effect.forEach(rendered, (value) => _collectOutputs({ value, appDir }))
    const application = child.argo === undefined ? [] : [yield* _applicationFile({ argo: child.argo, appsDirAbs })]

    return [...collected.flat(), ...application]
  })

const _renderEnvBody = (input: EnvTarget) =>
  Effect.gen(function*() {
    const { cfg, envName, ctx } = input
    const path = yield* Path
    const entry = yield* _resolveEnvEntry({ cfg, envName })
    const result = yield* _loadEnv(entry)

    const outDirAbs = yield* envOutDir(input)
    const appsDirAbs = path.join(outDirAbs, result.name)

    // Bounded at 4: keeps the helm/sops subprocess count manageable.
    const perAppFiles = yield* Effect.forEach(
      _childrenOf(result),
      (child) => _renderChild({ appsDirAbs, child, ctx, outDirAbs }),
      { concurrency: 4 }
    )

    const all = perAppFiles.flat()
    yield* _failOnCollisions(all)

    const files = Arr.dedupeWith(all, (a, b) => a.path === b.path)
    const rendered: RenderedEnv = { appsDirAbs, outDirAbs, files }

    return rendered
  }).pipe(Effect.scoped)

export const renderEnv = (input: EnvTarget) =>
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

interface WriteFilesToDirInput {
  readonly rendered: RenderedEnv
  readonly targetDir: string
}

const _isStrictlyInside = (input: { readonly path: Path; readonly root: string; readonly target: string }) => {
  const rel = input.path.relative(input.root, input.target)

  return !(rel === "" || rel === ".." || rel.startsWith(`..${input.path.sep}`) || input.path.isAbsolute(rel))
}

const _targetPathOf = (input: WriteFilesToDirInput & { readonly file: OutputFile }) =>
  Effect.gen(function*() {
    const path = yield* Path
    const { file, rendered, targetDir } = input
    const root = rendered.outDirAbs

    if (!_isStrictlyInside({ path, root, target: file.path })) {
      return yield* new UnsafeOutputPath({ path: file.path, root })
    }

    return path.join(targetDir, path.relative(root, file.path))
  })

const _writeOne = (input: { readonly targetPath: string; readonly content: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const { content, targetPath } = input
    const toError = (cause: unknown) => new WriteEnvError({ path: targetPath, cause })
    yield* fs.makeDirectory(path.dirname(targetPath), { recursive: true }).pipe(Effect.mapError(toError))
    yield* fs.writeFileString(targetPath, content, { mode: 0o600 }).pipe(Effect.mapError(toError))

    return targetPath
  })

// Re-homes `rendered.files` (keyed off `rendered.outDirAbs`) under an
// arbitrary `targetDir`, preserving the per-app layout/naming that
// `_renderChild`/`_collectOutputs` computed. Shared by `writeFiles` (staging
// dir for `konfig build`) and `konfig validate --strict` (a scratch temp dir
// so kubeconform sees the *current* render, not the last `build`'s output).
export const writeFilesToDir = (
  input: WriteFilesToDirInput
): Effect.Effect<ReadonlyArray<string>, WriteEnvError | UnsafeOutputPath, FileSystem | Path> =>
  Effect.gen(function*() {
    const targets = yield* Effect.forEach(input.rendered.files, (file) =>
      Effect.map(_targetPathOf({ ...input, file }), (targetPath) => ({ targetPath, content: file.content })))

    return yield* Effect.forEach(targets, _writeOne)
  })

const _removeIfExists = (target: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    const present = yield* existsOrFalse(target).pipe(
      Effect.mapError((cause) => new WriteEnvError({ path: target, cause }))
    )

    if (!present) return
    yield* fs
      .remove(target, { recursive: true })
      .pipe(Effect.mapError((cause) => new WriteEnvError({ path: target, cause })))
  })

const _promoteStaging = (input: { readonly stagingDir: string; readonly outDirAbs: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const toError = (cause: unknown) => new WriteEnvError({ path: input.outDirAbs, cause })
    yield* _removeIfExists(input.outDirAbs)
    yield* fs.makeDirectory(path.dirname(input.outDirAbs), { recursive: true }).pipe(Effect.mapError(toError))
    yield* fs.rename(input.stagingDir, input.outDirAbs).pipe(Effect.mapError(toError))
  })

const _assertInsideManifests = (input: { readonly cfg: ResolvedKonfigConfig; readonly outDirAbs: string }) =>
  Effect.gen(function*() {
    const path = yield* Path
    const root = yield* _manifestsRoot(input.cfg)

    if (!_isStrictlyInside({ path, root, target: input.outDirAbs })) {
      return yield* new OutDirOutsideManifests({ outDir: input.outDirAbs, root })
    }
  })

interface WriteFilesInput {
  readonly rendered: RenderedEnv
  readonly cfg: ResolvedKonfigConfig
}

// Atomic write: stage all files under `<outDir>.tmp`, then remove the live
// `<outDir>` and rename `.tmp` into place — a kill mid-write never leaves a
// half-rewritten live tree.
export const writeFiles = (
  input: WriteFilesInput
): Effect.Effect<ReadonlyArray<string>, WriteEnvError | OutDirOutsideManifests | UnsafeOutputPath, FileSystem | Path> =>
  Effect.gen(function*() {
    const { cfg, rendered } = input
    yield* _assertInsideManifests({ cfg, outDirAbs: rendered.outDirAbs })
    const stagingDir = `${rendered.outDirAbs}.tmp`
    yield* _removeIfExists(stagingDir)
    const fs = yield* FileSystem
    yield* fs.makeDirectory(stagingDir, { recursive: true }).pipe(
      Effect.mapError((cause) => new WriteEnvError({ path: stagingDir, cause }))
    )
    yield* writeFilesToDir({ rendered, targetDir: stagingDir })
    yield* _promoteStaging({ stagingDir, outDirAbs: rendered.outDirAbs })

    return rendered.files.map((file) => file.path)
  })
