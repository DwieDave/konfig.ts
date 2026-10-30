import { Console, Effect, Schema } from "effect"
import { Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import {
  decodeField,
  mapRepoError,
  packageDirs,
  type PackageJson,
  readJson,
  readRootCatalogs,
  REPO_ROOT,
  RepoScriptError,
  StringRecord
} from "../lib/repo"

// npm understands neither workspace:* nor catalog: protocols, so both must be
// resolved to concrete semver before npm publish. The effect family is the one
// exception: it publishes as a caret range (`^4.0.5`) so consumers resolve any
// compatible 4.x build, while dev and CI stay pinned to the exact catalog build.

export type DepRecord = Record<string, string>

type Catalogs = Record<string, DepRecord>

export interface _RewriteInput {
  readonly rec: DepRecord | undefined
  readonly version: string
  readonly catalog: DepRecord
  readonly namedCatalogs: Catalogs
  readonly pkgJsonPath: string
}

/** Packages whose published spec floats as a caret range instead of pinning exact. */
const EFFECT_FAMILY: ReadonlySet<string> = new Set(["effect", "@effect/platform-node", "@effect/vitest"])

/** `4.0.5` / `~4.0.5` → `^4.0.5`; specs that aren't a single version pass through unchanged. */
export const caretRange = (version: string) =>
  /^(?:\^|~)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? `^${version.replace(/^(?:\^|~)/, "")}` : version

const _WORKSPACE_PREFIX = "workspace:"

const _WORKSPACE_RANGES = {
  "*": (version) => version,
  "^": (version) => `^${version}`,
  "~": (version) => `~${version}`
} satisfies Record<string, (version: string) => string>

export const resolveWorkspaceSpec = (input: { readonly spec: string; readonly version: string }) => {
  const rest = input.spec.slice(_WORKSPACE_PREFIX.length)

  const range = Object.entries(_WORKSPACE_RANGES).find(([token]) => token === rest)

  return range !== undefined
    ? range[1](input.version)
    : /^[\^~]?\d/.test(rest)
    ? rest
    : undefined
}

const _resolveWorkspace = (input: _RewriteInput & { readonly name: string; readonly spec: string }) => {
  const resolved = input.name.startsWith("@konfig.ts/") ? resolveWorkspaceSpec(input) : undefined

  return resolved === undefined
    ? Effect.fail(
      new RepoScriptError({
        message: `${input.pkgJsonPath}: cannot resolve "${input.name}": "${input.spec}"`
      })
    )
    : Effect.succeed(resolved)
}

export const resolveCatalogSpec = (input: _RewriteInput & { readonly name: string; readonly spec: string }) =>
  Effect.gen(function*() {
    const { catalog, name, namedCatalogs, pkgJsonPath, spec } = input
    const group = spec.slice("catalog:".length)
    const table = group === "" ? catalog : namedCatalogs[group] ?? {}
    const resolved = table[name]

    if (resolved === undefined) {
      return yield* new RepoScriptError({
        message: `${pkgJsonPath}: no catalog entry for "${name}" (spec "${spec}")`
      })
    }

    return EFFECT_FAMILY.has(name) ? caretRange(resolved) : resolved
  })

const _rewriteSpec = (input: _RewriteInput & { readonly name: string; readonly spec: string }) =>
  input.spec.startsWith(_WORKSPACE_PREFIX)
    ? _resolveWorkspace(input)
    : input.spec.startsWith("catalog:")
    ? resolveCatalogSpec(input)
    : Effect.succeed(input.spec)

export const rewriteRecord = (input: _RewriteInput) =>
  Effect.forEach(
    Object.entries(input.rec ?? {}),
    ([name, spec]) => _rewriteSpec({ ...input, name, spec }).pipe(Effect.map((next): [string, string] => [name, next]))
  ).pipe(Effect.map((entries) => input.rec === undefined ? undefined : Object.fromEntries(entries)))

const _DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

const _readVersion = Effect.gen(function*() {
  const path = yield* Path
  const core = yield* readJson(path.join(REPO_ROOT, "packages", "core", "package.json"))
  const version = core.version ?? "0.0.0"

  if (version === "0.0.0") {
    return yield* new RepoScriptError({
      message: `refusing to rewrite — @konfig.ts/core version is "${version}"`
    })
  }

  return version
})

const _differs = (input: { readonly before: DepRecord; readonly after: DepRecord }) =>
  Object.entries(input.after).some(([name, spec]) => input.before[name] !== spec)

const _rewriteField = (input: _RewriteInput & { readonly pkg: PackageJson; readonly field: string }) =>
  Effect.gen(function*() {
    const before = yield* decodeField({
      schema: Schema.UndefinedOr(StringRecord),
      value: input.pkg[input.field],
      what: `${input.pkgJsonPath} ${input.field}`
    })

    const after = yield* rewriteRecord({ ...input, rec: before })

    return before !== undefined && after !== undefined && _differs({ before, after })
      ? { [input.field]: after }
      : {}
  })

export const rewritePackage = (input: {
  readonly dir: string
  readonly version: string
  readonly catalog: DepRecord
  readonly namedCatalogs: Catalogs
}) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const pkgJsonPath = path.join(input.dir, "package.json")
    const pkg = yield* readJson(pkgJsonPath)

    const patches = yield* Effect.forEach(
      _DEP_FIELDS,
      (field) => _rewriteField({ ...input, rec: undefined, pkgJsonPath, pkg, field })
    )

    if (patches.every((patch) => Object.keys(patch).length === 0)) return
    yield* fs
      .writeFileString(pkgJsonPath, `${JSON.stringify(Object.assign({}, pkg, ...patches), null, "\t")}\n`)
      .pipe(mapRepoError(`cannot write ${pkgJsonPath}`))
    yield* Console.log(`rewrote ${path.relative(REPO_ROOT, pkgJsonPath)}`)
  })

const _runRewrite = Effect.gen(function*() {
  const { catalog, namedCatalogs } = yield* readRootCatalogs
  const version = yield* _readVersion

  yield* Effect.forEach(yield* packageDirs, (dir) => rewritePackage({ dir, version, catalog, namedCatalogs }))
  yield* Console.log(`done — resolved workspace: and catalog: deps to concrete versions (v${version})`)
})

export const rewriteWorkspaceDepsCommand = Command.make("rewrite-workspace-deps", {}, () => _runRewrite).pipe(
  Command.withDescription("Resolve workspace: and catalog: protocol deps to concrete versions before npm publish")
)
