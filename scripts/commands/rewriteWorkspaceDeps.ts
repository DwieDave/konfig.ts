import { Console, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Command } from "effect/unstable/cli"
import { packageDirs, readJson, REPO_ROOT, RepoScriptError } from "../lib/repo"

// npm understands neither workspace:* nor catalog: protocols, so both must be
// resolved to concrete semver before npm publish. The effect family is the one
// exception: it publishes as a caret range over the release-candidate line
// (`^4.0.0-rc.N`) so consumers resolve any rc build from N on, while dev and CI
// stay pinned to the exact catalog build.

export type DepRecord = Record<string, string>
type Catalogs = Record<string, DepRecord>

export interface _RewriteInput {
  readonly rec: DepRecord | undefined
  readonly version: string
  readonly catalog: DepRecord
  readonly namedCatalogs: Catalogs
  readonly pkgJsonPath: string
}

/** Packages whose published spec floats across the rc line instead of pinning exact. */
const EFFECT_FAMILY: Record<string, true> = {
  "effect": true,
  "@effect/platform-node": true,
  "@effect/vitest": true
}

/** `4.0.0-rc.111` → `^4.0.0-rc.111`; non-prerelease versions pass through unchanged. */
export const _caretRcRange = (version: string) =>
  /^(?:\^|~)?(\d+\.\d+\.\d+-[0-9A-Za-z.-]+)$/.test(version) ? `^${version.replace(/^(?:\^|~)/, "")}` : version

export const _rewriteRecord = (input: _RewriteInput) =>
  Effect.gen(function*() {
    const { catalog, namedCatalogs, pkgJsonPath, rec, version } = input
    if (rec === undefined) return false
    let changed = false
    for (const [name, spec] of Object.entries(rec)) {
      if (typeof spec !== "string") continue
      if (
        name.startsWith("@konfig.ts/")
        && (spec === "workspace:*" || spec === "workspace:^" || spec === "workspace:~")
      ) {
        rec[name] = version
        changed = true
      } else if (spec.startsWith("catalog:")) {
        const group = spec.slice("catalog:".length)
        const table = group === "" ? catalog : namedCatalogs[group] ?? {}
        const resolved = table[name]
        if (resolved === undefined) {
          return yield* new RepoScriptError({
            message: `${pkgJsonPath}: no catalog entry for "${name}" (spec "${spec}")`
          })
        }
        rec[name] = EFFECT_FAMILY[name] === true ? _caretRcRange(resolved) : resolved
        changed = true
      }
    }
    return changed
  })

export const rewriteWorkspaceDepsCommand = Command.make(
  "rewrite-workspace-deps",
  {},
  () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      const rootPkg = yield* readJson(path.join(REPO_ROOT, "package.json"))
      const catalog = (rootPkg.catalog ?? {}) as DepRecord
      const namedCatalogs = (rootPkg.catalogs ?? {}) as Catalogs

      const core = yield* readJson(path.join(REPO_ROOT, "packages", "core", "package.json"))
      const version = typeof core.version === "string" ? core.version : "0.0.0"
      if (version === "0.0.0") {
        return yield* new RepoScriptError({
          message: `refusing to rewrite — @konfig.ts/core version is "${version}"`
        })
      }

      for (const dir of yield* packageDirs) {
        const pkgJsonPath = path.join(dir, "package.json")
        const pkg = { ...(yield* readJson(pkgJsonPath)) } as Record<string, unknown>
        let touched = false
        for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
          const changed = yield* _rewriteRecord({
            rec: pkg[field] as DepRecord | undefined,
            version,
            catalog,
            namedCatalogs,
            pkgJsonPath
          })
          touched = changed || touched
        }
        if (touched) {
          yield* fs
            .writeFileString(pkgJsonPath, `${JSON.stringify(pkg, null, "\t")}\n`)
            .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot write ${pkgJsonPath}`, cause })))
          yield* Console.log(`rewrote ${path.relative(REPO_ROOT, pkgJsonPath)}`)
        }
      }
      yield* Console.log(`done — resolved workspace:* and catalog: deps to concrete versions (v${version})`)
    })
).pipe(
  Command.withDescription("Resolve workspace:* and catalog: protocol deps to concrete versions before npm publish")
)
