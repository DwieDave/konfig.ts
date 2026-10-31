import { isRecord } from "@konfig.ts/core"
import { Effect, type Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { type Declaration, type ExportAllDeclaration, type ExportNamedDeclaration, parseSync } from "oxc-parser"
import { mapRepoError, type RepoScriptError } from "./repo"

type _Statement = ReturnType<typeof parseSync>["program"]["body"][number]

interface ReExport {
  readonly from: string
  readonly alias: string | undefined
}

export interface FileExports {
  readonly names: ReadonlyArray<string>
  readonly stars: ReadonlyArray<ReExport>
}

const _identifierName = (node: { readonly type: string; readonly name?: string } | null | undefined) =>
  node?.type === "Identifier" && node.name !== undefined ? [node.name] : []

const _declarationNames = (decl: Declaration): ReadonlyArray<string> =>
  decl.type === "VariableDeclaration"
    ? decl.declarations.flatMap((d) => _identifierName(d.id))
    : _identifierName("id" in decl ? decl.id : null)

const _specifierNames = (node: ExportNamedDeclaration): ReadonlyArray<string> =>
  node.specifiers.map((s) => (s.exported.type === "Literal" ? String(s.exported.value) : s.exported.name))

const _namedExports = (node: ExportNamedDeclaration): ReadonlyArray<string> =>
  node.declaration === null ? _specifierNames(node) : _declarationNames(node.declaration)

const _star = (node: ExportAllDeclaration): ReExport => ({
  from: node.source.value,
  alias: node.exported === null ? undefined : String("name" in node.exported ? node.exported.name : node.exported.value)
})

const _isNamed = (node: _Statement): node is ExportNamedDeclaration => node.type === "ExportNamedDeclaration"

const _isStar = (node: _Statement): node is ExportAllDeclaration => node.type === "ExportAllDeclaration"

export const parseExports = (input: { readonly file: string; readonly code: string }): FileExports => {
  const body = parseSync(input.file, input.code).program.body

  return {
    names: body.filter(_isNamed).flatMap(_namedExports),
    stars: body.filter(_isStar).map(_star)
  }
}

const _resolveRelative = (input: { readonly fromFile: string; readonly spec: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const base = path.resolve(path.dirname(input.fromFile), input.spec)
    const candidates = [`${base}.ts`, path.join(base, "index.ts")]
    const found = yield* Effect.filter(candidates, (c) => fs.exists(c))

    return found[0]
  }).pipe(mapRepoError(`cannot resolve ${input.spec} from ${input.fromFile}`))

const _prefixed = (input: { readonly alias: string | undefined; readonly names: ReadonlyArray<string> }) =>
  input.alias === undefined ? input.names : [input.alias, ...input.names.map((n) => `${input.alias}.${n}`)]

const _starNames = (input: { readonly fromFile: string; readonly star: ReExport }) =>
  Effect.gen(function*() {
    const target = input.star.from.startsWith(".")
      ? yield* _resolveRelative({ fromFile: input.fromFile, spec: input.star.from })
      : undefined

    const names = target === undefined ? [] : yield* _fileSurface(target)

    return _prefixed({ alias: input.star.alias, names })
  })

const _fileSurface = (file: string): Effect.Effect<ReadonlyArray<string>, RepoScriptError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const code = yield* fs.readFileString(file).pipe(mapRepoError(`cannot read ${file}`))
    const parsed = parseExports({ file, code })
    const fromStars = yield* Effect.forEach(parsed.stars, (star) => _starNames({ fromFile: file, star }))

    return [...parsed.names, ...fromStars.flat()]
  })

const _isNamespaceLike = (value: unknown): value is { readonly [key: string]: Schema.Json } =>
  isRecord(value) && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))

const _membersOf = (input: { readonly key: string; readonly value: unknown }): ReadonlyArray<string> =>
  _isNamespaceLike(input.value) ? [input.key, ...Object.keys(input.value).map((m) => `${input.key}.${m}`)] : [input.key]

export const packageSurface = (barrel: string) =>
  Effect.gen(function*() {
    const parsed = yield* _fileSurface(barrel)
    const module = yield* Effect.tryPromise(() => import(barrel)).pipe(mapRepoError(`cannot import ${barrel}`))
    const runtime = Object.entries(module).flatMap(([key, value]) => _membersOf({ key, value }))

    return [...new Set([...parsed, ...runtime])].sort()
  })

export interface SurfaceDiff {
  readonly removed: ReadonlyArray<string>
  readonly added: ReadonlyArray<string>
}

export const diffSurface = (input: {
  readonly recorded: ReadonlyArray<string>
  readonly current: ReadonlyArray<string>
}): SurfaceDiff => {
  const recorded = new Set(input.recorded)
  const current = new Set(input.current)

  return {
    removed: input.recorded.filter((name) => !current.has(name)),
    added: input.current.filter((name) => !recorded.has(name))
  }
}
