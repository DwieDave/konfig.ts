import { diffFiles, type DiffFormat, formatDiff, hasDifferences } from "@konfig.ts/core"
import {
  DockerWriteError,
  DockerWriteRefused,
  emit,
  extractHeader,
  findRoot,
  HEADER_MARKER,
  isDockerApp
} from "@konfig.ts/docker"
import { Console, Data, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { moduleDefault } from "../moduleDefault"
import { formatFlag } from "../renderContextFlags"

export class SpecImportError extends Data.TaggedError("SpecImportError")<{
  readonly specPath: string
  readonly cause: unknown
}> {}

export class SpecNotADockerApp extends Data.TaggedError("SpecNotADockerApp")<{
  readonly specPath: string
}> {}

export class DiffDrift extends Data.TaggedError("DiffDrift")<{
  readonly target: string
  readonly kind: "prod" | "dev"
}> {}

export interface SpecLoad {
  readonly app: import("@konfig.ts/docker").DockerApp
  readonly targetAbs: string
  readonly specPath: string
  readonly root: string
}

export const loadSpec = (
  targetArg: string
): Effect.Effect<
  SpecLoad,
  SpecImportError | SpecNotADockerApp | import("@konfig.ts/docker").AnyDockerError,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const p = yield* Path
    const targetAbs = p.resolve(process.cwd(), targetArg)
    const dockerTsPath = p.join(targetAbs, "docker.ts")
    const mod = yield* Effect.tryPromise({
      try: () => import(dockerTsPath),
      catch: (e) => new SpecImportError({ specPath: dockerTsPath, cause: e })
    })
    const app = moduleDefault(mod)
    if (!isDockerApp(app)) {
      return yield* new SpecNotADockerApp({ specPath: dockerTsPath })
    }
    const root = yield* findRoot(targetAbs)
    const specPath = p.relative(root, dockerTsPath)
    return { app, targetAbs, specPath, root }
  })

export const emitFor = (load: SpecLoad) =>
  emit({ spec: { ...load.app.spec, target: load.targetAbs }, specPath: load.specPath })

export interface DockerVariant {
  readonly kind: "prod" | "dev"
  readonly file: "Dockerfile" | "Dockerfile.dev"
  readonly content: string
}

export interface VariantsInput {
  readonly emitted: { readonly dockerfile: string; readonly dockerfileDev?: string | undefined }
  readonly prodOnly: boolean
  readonly devOnly: boolean
}

export const variantsOf = ({ devOnly, emitted, prodOnly }: VariantsInput): ReadonlyArray<DockerVariant> => [
  ...(devOnly ? [] : [{ kind: "prod", file: "Dockerfile", content: emitted.dockerfile } as const]),
  ...(prodOnly || !emitted.dockerfileDev
    ? []
    : [{ kind: "dev", file: "Dockerfile.dev", content: emitted.dockerfileDev } as const])
]

export interface WriteAtomicInput {
  readonly fs: FileSystem
  readonly path: string
  readonly content: string
}

export const writeAtomic = (input: WriteAtomicInput): Effect.Effect<void, DockerWriteError> =>
  Effect.gen(function*() {
    const { content, fs, path } = input
    const tmp = `${path}.tmp.${process.pid}`
    yield* fs.writeFileString(tmp, content)
    yield* fs.rename(tmp, path)
  }).pipe(Effect.mapError((cause) => new DockerWriteError({ path: input.path, cause })))

export interface WriteOneInput {
  readonly dest: string
  readonly content: string
  readonly force: boolean
}

export const writeOne = (
  input: WriteOneInput
): Effect.Effect<{ written: boolean }, DockerWriteRefused | DockerWriteError, FileSystem | Path> =>
  Effect.gen(function*() {
    const { content, dest, force } = input
    const fs = yield* FileSystem
    const existed = yield* fs.exists(dest).pipe(Effect.orElseSucceed(() => false))
    if (existed) {
      const existing = yield* fs.readFileString(dest).pipe(Effect.orElseSucceed(() => ""))
      const head = extractHeader(existing)
      if (!head.managed && !force) {
        return yield* new DockerWriteRefused({
          path: dest,
          reason: `destination is not konfig-managed (missing marker "${HEADER_MARKER}"). Use --force to overwrite.`
        })
      }
      if (head.managed && existing === content) return { written: false }
    }
    yield* writeAtomic({ fs, path: dest, content })
    return { written: true }
  })

export interface PreviewArgs {
  readonly target: string
  readonly prodOnly: boolean
  readonly devOnly: boolean
}

export const previewEffect = (
  args: PreviewArgs
): Effect.Effect<
  void,
  SpecImportError | SpecNotADockerApp | import("@konfig.ts/docker").AnyDockerError,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const load = yield* loadSpec(args.target)
    const e = yield* emitFor(load)
    yield* Effect.forEach(variantsOf({ emitted: e, ...args }), (v) =>
      Console.log(v.kind === "dev" && !args.devOnly ? `\n# ---- Dockerfile.dev ----\n\n${v.content}` : v.content))
  })

const previewCommand = Command.make(
  "preview",
  {
    target: Argument.String("target").pipe(Argument.withDescription("workspace dir relative to cwd")),
    prodOnly: Flag.Boolean("prod-only").pipe(
      Flag.withDescription("only emit the prod Dockerfile"),
      Flag.withDefault(false)
    ),
    devOnly: Flag.Boolean("dev-only").pipe(
      Flag.withDescription("only emit the dev Dockerfile"),
      Flag.withDefault(false)
    )
  },
  (args) => previewEffect(args)
).pipe(Command.withDescription("Render Dockerfile(s) for a target to stdout"))

export interface WriteArgs {
  readonly target: string
  readonly outDir: { readonly _tag: "Some"; readonly value: string } | { readonly _tag: "None" }
  readonly prodOnly: boolean
  readonly devOnly: boolean
  readonly force: boolean
}

export const writeEffect = (
  args: WriteArgs
): Effect.Effect<
  void,
  | SpecImportError
  | SpecNotADockerApp
  | import("@konfig.ts/docker").AnyDockerError
  | DockerWriteRefused
  | DockerWriteError,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const p = yield* Path
    const load = yield* loadSpec(args.target)
    const e = yield* emitFor(load)
    const outDirAbs = args.outDir._tag === "Some"
      ? p.resolve(process.cwd(), args.outDir.value)
      : load.targetAbs
    yield* Effect.forEach(variantsOf({ emitted: e, ...args }), (v) =>
      Effect.gen(function*() {
        const dest = p.join(outDirAbs, v.file)
        const r = yield* writeOne({ dest, content: v.content, force: args.force })
        yield* Console.log(r.written ? `wrote ${dest}` : `unchanged ${dest}`)
      }))
  })

const writeCommand = Command.make(
  "write",
  {
    target: Argument.String("target").pipe(Argument.withDescription("workspace dir relative to cwd")),
    outDir: Flag.String("out-dir").pipe(
      Flag.withDescription("destination directory (default: <target>)"),
      Flag.optional
    ),
    prodOnly: Flag.Boolean("prod-only").pipe(Flag.withDefault(false)),
    devOnly: Flag.Boolean("dev-only").pipe(Flag.withDefault(false)),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("overwrite a destination file even if it is not konfig-managed"),
      Flag.withDefault(false)
    )
  },
  (args) => writeEffect(args)
).pipe(Command.withDescription("Write Dockerfile + Dockerfile.dev next to a target"))

export interface DiffOneInput {
  readonly dest: string
  readonly emitted: string
  readonly kind: "prod" | "dev"
  readonly target: string
  readonly format: DiffFormat
}

export const diffOne = (input: DiffOneInput): Effect.Effect<void, DiffDrift, FileSystem | Path> =>
  Effect.gen(function*() {
    const { dest, emitted, format, kind, target } = input
    const fs = yield* FileSystem
    const onDisk = yield* fs.readFileString(dest).pipe(Effect.orElseSucceed(() => ""))
    const head = extractHeader(onDisk)
    const emittedHead = extractHeader(emitted)
    if (head.managed && emittedHead.managed && head.hash === emittedHead.hash) return
    const result = diffFiles({
      left: { [dest]: onDisk },
      right: { [dest]: emitted }
    })
    if (!hasDifferences(result)) return
    yield* Console.log(formatDiff({ result, format }))
    return yield* new DiffDrift({ target, kind })
  })

export interface DiffArgs {
  readonly target: string
  readonly format: DiffFormat
}

export const diffEffect = (
  args: DiffArgs
): Effect.Effect<
  void,
  SpecImportError | SpecNotADockerApp | import("@konfig.ts/docker").AnyDockerError | DiffDrift,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const p = yield* Path
    const load = yield* loadSpec(args.target)
    const e = yield* emitFor(load)
    yield* Effect.forEach(variantsOf({ emitted: e, prodOnly: false, devOnly: false }), (v) =>
      diffOne({
        dest: p.join(load.targetAbs, v.file),
        emitted: v.content,
        kind: v.kind,
        target: args.target,
        format: args.format
      }))
    yield* Console.log(`OK — ${args.target} matches`)
  })

const diffCommand = Command.make(
  "diff",
  {
    target: Argument.String("target").pipe(Argument.withDescription("workspace dir relative to cwd")),
    format: formatFlag
  },
  (args) => diffEffect(args)
).pipe(Command.withDescription("Diff would-emit Dockerfiles vs on-disk; non-zero exit on drift"))

export const dockerCommand = Command.make("docker").pipe(
  Command.withDescription("Generate Dockerfile + Dockerfile.dev from a target's docker.ts spec"),
  Command.withSubcommands([previewCommand, writeCommand, diffCommand])
)
