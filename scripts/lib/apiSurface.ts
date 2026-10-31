import { isRecord } from "@konfig.ts/core"
import { Effect, Match, type Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { type Declaration, type ExportAllDeclaration, type ExportNamedDeclaration, parseSync } from "oxc-parser"
import { mapRepoError, type RepoScriptError } from "./repo"

type _Statement = ReturnType<typeof parseSync>["program"]["body"][number]

interface ReExport {
  readonly from: string
  readonly alias: string | undefined
}

interface NamedReExport {
  readonly from: string
  readonly local: string
  readonly exported: string
}

export interface FileExports {
  readonly names: ReadonlyArray<string>
  readonly stars: ReadonlyArray<ReExport>
  readonly named: ReadonlyArray<NamedReExport>
}

const _identifierName = (node: { readonly type: string; readonly name?: string } | null | undefined) =>
  node?.type === "Identifier" && node.name !== undefined ? [node.name] : []

const _DECLARATION_TYPES: ReadonlySet<string> = new Set([
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration"
])

const _isDeclaration = (node: _Statement): node is Declaration & _Statement => _DECLARATION_TYPES.has(node.type)

const _statementNames = (node: _Statement): ReadonlyArray<string> =>
  node.type === "ExportNamedDeclaration"
    ? node.declaration === null ? [] : _declarationNames(node.declaration)
    : _isDeclaration(node)
    ? _declarationNames(node)
    : []

const _namespaceNames = (decl: Declaration & { readonly type: "TSModuleDeclaration" }): ReadonlyArray<string> => {
  const name = _identifierName(decl.id)[0]
  const members = decl.body?.type === "TSModuleBlock" ? decl.body.body.flatMap(_statementNames) : []

  return name === undefined ? [] : [name, ...members.map((m) => `${name}.${m}`)]
}

const _declarationNames = (decl: Declaration): ReadonlyArray<string> =>
  Match.value(decl).pipe(
    Match.when({ type: "TSModuleDeclaration" }, _namespaceNames),
    Match.when({ type: "VariableDeclaration" }, (v) => v.declarations.flatMap((d) => _identifierName(d.id))),
    Match.orElse((other) => _identifierName("id" in other ? other.id : null))
  )

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

const _relativeSpecifiers = (node: ExportNamedDeclaration): ReadonlyArray<NamedReExport> =>
  node.source !== null && node.source.value.startsWith(".")
    ? node.specifiers.map((s) => ({
      from: node.source?.value ?? "",
      local: s.local.type === "Literal" ? String(s.local.value) : s.local.name,
      exported: s.exported.type === "Literal" ? String(s.exported.value) : s.exported.name
    }))
    : []

export const parseExports = (input: { readonly file: string; readonly code: string }): FileExports => {
  const body = parseSync(input.file, input.code).program.body
  const named = body.filter(_isNamed)

  return {
    names: named.flatMap(_namedExports),
    stars: body.filter(_isStar).map(_star),
    named: named.flatMap(_relativeSpecifiers)
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

const _memberRenames = (input: { readonly names: ReadonlyArray<string>; readonly ref: NamedReExport }) =>
  input.names
    .filter((n) => n.startsWith(`${input.ref.local}.`))
    .map((n) => `${input.ref.exported}${n.slice(input.ref.local.length)}`)

const _namedMembers = (input: { readonly fromFile: string; readonly ref: NamedReExport }) =>
  Effect.gen(function*() {
    const target = yield* _resolveRelative({ fromFile: input.fromFile, spec: input.ref.from })
    const names = target === undefined ? [] : yield* _fileSurface(target)

    return _memberRenames({ names, ref: input.ref })
  })

const _fileSurface = (file: string): Effect.Effect<ReadonlyArray<string>, RepoScriptError, FileSystem | Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const code = yield* fs.readFileString(file).pipe(mapRepoError(`cannot read ${file}`))
    const parsed = parseExports({ file, code })
    const fromStars = yield* Effect.forEach(parsed.stars, (star) => _starNames({ fromFile: file, star }))
    const fromNamed = yield* Effect.forEach(parsed.named, (ref) => _namedMembers({ fromFile: file, ref }))

    return [...parsed.names, ...fromStars.flat(), ...fromNamed.flat()]
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
