import { type DiffFormat, orElseIfNotFound, readOrEmpty } from "@konfig.ts/core"
import {
  type AnyDockerError,
  type DockerApp,
  DockerWriteError,
  DockerWriteRefused,
  emit,
  extractHeader,
  findRoot,
  HEADER_MARKER,
  isDockerApp
} from "@konfig.ts/docker"
import { Console, Data, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { moduleDefault } from "../moduleDefault"
import { formatFlag } from "../renderContextFlags"
import { renderDockerDiff } from "./dockerDiff"

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

interface SpecLoad {
  readonly app: DockerApp
  readonly targetAbs: string
  readonly specPath: string
  readonly root: string
}

export const loadSpec = (
  targetArg: string
): Effect.Effect<
  SpecLoad,
  SpecImportError | SpecNotADockerApp | AnyDockerError,
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
  emit({ spec: load.app.spec, target: load.targetAbs, specPath: load.specPath })

interface DockerVariant {
  readonly kind: "prod" | "dev"
  readonly file: "Dockerfile" | "Dockerfile.dev"
  readonly content: string
}

type DockerKind = DockerVariant["kind"]

interface VariantsInput {
  readonly emitted: { readonly dockerfile: string; readonly dockerfileDev?: string | undefined }
  readonly only: Option.Option<DockerKind>
}

export const variantsOf = ({ emitted, only }: VariantsInput): ReadonlyArray<DockerVariant> =>
  [
    { kind: "prod", file: "Dockerfile", content: emitted.dockerfile } as const,
    ...(emitted.dockerfileDev
      ? [{ kind: "dev", file: "Dockerfile.dev", content: emitted.dockerfileDev } as const]
      : [])
  ].filter((v) => Option.match(only, { onNone: () => true, onSome: (kind) => kind === v.kind }))

const onlyFlag = Flag.Literals("only", ["prod", "dev"] as const).pipe(
  Flag.withDescription("emit only the prod or the dev Dockerfile"),
  Flag.optional
)

interface WriteAtomicInput {
  readonly path: string
  readonly content: string
}

const _dockerWriteError = (path: string) => (cause: unknown): DockerWriteError => new DockerWriteError({ path, cause })

export const writeAtomic = (input: WriteAtomicInput): Effect.Effect<void, DockerWriteError, FileSystem> =>
  Effect.gen(function*() {
    const { content, path } = input
    const fs = yield* FileSystem
    const tmp = `${path}.tmp.${process.pid}`
    yield* fs.writeFileString(tmp, content)
    yield* fs.rename(tmp, path)
  }).pipe(Effect.mapError(_dockerWriteError(input.path)))

interface WriteOneInput {
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

    const existing = yield* orElseIfNotFound({ effect: fs.readFileString(dest), fallback: undefined }).pipe(
      Effect.mapError(_dockerWriteError(dest))
    )

    if (existing !== undefined) {
      const head = extractHeader(existing)

      if (!head.managed && !force) {
        return yield* new DockerWriteRefused({
          path: dest,
          reason: `destination is not konfig-managed (missing marker "${HEADER_MARKER}"). Use --force to overwrite.`
        })
      }

      if (head.managed && existing === content) return { written: false }
    }

    yield* writeAtomic({ path: dest, content })

    return { written: true }
  })

interface PreviewArgs {
  readonly target: string
  readonly only: Option.Option<DockerKind>
}

export const previewEffect = (
  args: PreviewArgs
): Effect.Effect<
  void,
  SpecImportError | SpecNotADockerApp | AnyDockerError,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const load = yield* loadSpec(args.target)
    const e = yield* emitFor(load)
    yield* Effect.forEach(variantsOf({ emitted: e, ...args }), (v) =>
      Console.log(
        v.kind === "dev" && Option.isNone(args.only) ? `\n# ---- Dockerfile.dev ----\n\n${v.content}` : v.content
      ))
  })

const previewCommand = Command.make(
  "preview",
  {
    target: Argument.String("target").pipe(Argument.withDescription("workspace dir relative to cwd")),
    only: onlyFlag
  },
  (args) => previewEffect(args)
).pipe(Command.withDescription("Render Dockerfile(s) for a target to stdout"))

interface WriteArgs {
  readonly target: string
  readonly outDir: Option.Option<string>
  readonly only: Option.Option<DockerKind>
  readonly force: boolean
}

interface EnsureOutDirInput {
  readonly outDir: Option.Option<string>
  readonly targetAbs: string
}

const _ensureOutDir = (input: EnsureOutDirInput): Effect.Effect<string, DockerWriteError, FileSystem | Path> =>
  Option.match(input.outDir, {
    onNone: () => Effect.succeed(input.targetAbs),
    onSome: (dir) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem
        const p = yield* Path
        const abs = p.resolve(process.cwd(), dir)
        yield* fs.makeDirectory(abs, { recursive: true }).pipe(Effect.mapError(_dockerWriteError(abs)))

        return abs
      })
  })

export const writeEffect = (
  args: WriteArgs
): Effect.Effect<
  void,
  | SpecImportError
  | SpecNotADockerApp
  | AnyDockerError
  | DockerWriteRefused
  | DockerWriteError,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const p = yield* Path
    const load = yield* loadSpec(args.target)
    const e = yield* emitFor(load)
    const outDirAbs = yield* _ensureOutDir({ outDir: args.outDir, targetAbs: load.targetAbs })

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
    only: onlyFlag,
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
    const onDisk = yield* readOrEmpty(dest).pipe(Effect.orDie)

    if (onDisk === emitted) return
    yield* Console.log(renderDockerDiff({ left: onDisk, right: emitted, format }))

    return yield* new DiffDrift({ target, kind })
  })

interface DiffArgs {
  readonly target: string
  readonly format: DiffFormat
}

export const diffEffect = (
  args: DiffArgs
): Effect.Effect<
  void,
  SpecImportError | SpecNotADockerApp | AnyDockerError | DiffDrift,
  FileSystem | Path
> =>
  Effect.gen(function*() {
    const p = yield* Path
    const load = yield* loadSpec(args.target)
    const e = yield* emitFor(load)
    yield* Effect.forEach(variantsOf({ emitted: e, only: Option.none() }), (v) =>
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
