import { Console, Effect, Schema } from "effect"
import { Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { decodeField, mapRepoError, packageDirs, readJson, REPO_ROOT, RepoScriptError, StringRecord } from "../lib/repo"

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
const EFFECT_FAMILY: Record<string, true> = {
  "effect": true,
  "@effect/platform-node": true,
  "@effect/vitest": true
}

/** `4.0.5` / `~4.0.5` → `^4.0.5`; specs that aren't a single version pass through unchanged. */
export const caretRange = (version: string) =>
  /^(?:\^|~)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? `^${version.replace(/^(?:\^|~)/, "")}` : version

export const _isWorkspaceSpec = (input: { readonly name: string; readonly spec: string }) =>
  input.name.startsWith("@konfig.ts/")
  && (input.spec === "workspace:*" || input.spec === "workspace:^" || input.spec === "workspace:~")

export const _resolveCatalogSpec = (input: _RewriteInput & { readonly name: string; readonly spec: string }) =>
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
    return EFFECT_FAMILY[name] === true ? caretRange(resolved) : resolved
  })

export const rewriteRecord = (input: _RewriteInput) =>
  Effect.gen(function*() {
    const { rec, version } = input
    if (rec === undefined) return false
    let changed = false
    for (const [name, spec] of Object.entries(rec)) {
      if (typeof spec !== "string") continue
      if (_isWorkspaceSpec({ name, spec })) {
        rec[name] = version
        changed = true
      } else if (spec.startsWith("catalog:")) {
        rec[name] = yield* _resolveCatalogSpec({ ...input, name, spec })
        changed = true
      }
    }
    return changed
  })

const _DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

const _readCatalogs = Effect.gen(function*() {
  const path = yield* Path
  const rootPkg = yield* readJson(path.join(REPO_ROOT, "package.json"))
  const catalog = (yield* decodeField({
    schema: Schema.UndefinedOr(StringRecord),
    value: rootPkg.catalog,
    what: "root catalog"
  })) ?? {}
  const namedCatalogs = (yield* decodeField({
    schema: Schema.UndefinedOr(Schema.Record(Schema.String, StringRecord)),
    value: rootPkg.catalogs,
    what: "root catalogs"
  })) ?? {}
  return { catalog, namedCatalogs }
})

const _readVersion = Effect.gen(function*() {
  const path = yield* Path
  const core = yield* readJson(path.join(REPO_ROOT, "packages", "core", "package.json"))
  const version = typeof core.version === "string" ? core.version : "0.0.0"
  if (version === "0.0.0") {
    return yield* new RepoScriptError({
      message: `refusing to rewrite — @konfig.ts/core version is "${version}"`
    })
  }
  return version
})

export const _rewritePackage = (input: {
  readonly dir: string
  readonly version: string
  readonly catalog: DepRecord
  readonly namedCatalogs: Catalogs
}) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const pkgJsonPath = path.join(input.dir, "package.json")
    const pkg = { ...(yield* readJson(pkgJsonPath)) }
    let touched = false
    for (const field of _DEP_FIELDS) {
      const rec = yield* decodeField({
        schema: Schema.UndefinedOr(StringRecord),
        value: pkg[field],
        what: `${pkgJsonPath} ${field}`
      })
      const changed = yield* rewriteRecord({ ...input, rec, pkgJsonPath })
      if (changed) pkg[field] = rec
      touched = changed || touched
    }
    if (!touched) return
    yield* fs
      .writeFileString(pkgJsonPath, `${JSON.stringify(pkg, null, "\t")}\n`)
      .pipe(mapRepoError(`cannot write ${pkgJsonPath}`))
    yield* Console.log(`rewrote ${path.relative(REPO_ROOT, pkgJsonPath)}`)
  })

const _runRewrite = Effect.gen(function*() {
  const { catalog, namedCatalogs } = yield* _readCatalogs
  const version = yield* _readVersion
  for (const dir of yield* packageDirs) {
    yield* _rewritePackage({ dir, version, catalog, namedCatalogs })
  }
  yield* Console.log(`done — resolved workspace:* and catalog: deps to concrete versions (v${version})`)
})

export const rewriteWorkspaceDepsCommand = Command.make("rewrite-workspace-deps", {}, () => _runRewrite).pipe(
  Command.withDescription("Resolve workspace:* and catalog: protocol deps to concrete versions before npm publish")
)
