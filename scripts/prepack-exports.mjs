#!/usr/bin/env node
// Rewrite the current package's `exports` map for `npm publish`.
//
// Run in a package directory (cwd), via the package's `prepack`/`postpack`
// lifecycle scripts:
//
//   prepack:  node ../../scripts/prepack-exports.mjs strip
//   postpack: node ../../scripts/prepack-exports.mjs restore
//
// Why: the dev checkout points the `bun` and `source` export conditions at
// `./src/index.ts` so that `check`/`test` resolve TypeScript source without a
// build. But `src/` is excluded from `files[]`, and the release publishes via
// plain `npm publish`, which does NOT apply `publishConfig.exports`. Bun
// prioritizes the `bun` condition, so a published tarball with a verbatim
// `bun → ./src/index.ts` is unresolvable for the primary audience.
//
// `strip` rewrites the dot-export to keep only `types` (→ dist .d.ts) and
// `import` (→ dist .mjs), drops the now-redundant `publishConfig.exports`, and
// first copies the untouched file to a sibling backup. `restore` moves the
// backup back verbatim — losslessly and independent of git, so it never clobbers
// other uncommitted edits (e.g. a workspace:*→exact version rewrite) the way a
// `git checkout` would.

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const PKG_JSON = path.resolve(process.cwd(), "package.json")
const BACKUP = `${PKG_JSON}.prepack-backup`

const strip = () => {
	const raw = fs.readFileSync(PKG_JSON, "utf8")
	const pkg = JSON.parse(raw)
	const dot = pkg.exports?.["."]
	if (!dot) {
		console.error(`prepack-exports: ${pkg.name ?? PKG_JSON} has no exports["."]; nothing to strip`)
		return
	}
	// Back up the exact pre-strip bytes so `restore` is lossless and git-independent.
	fs.writeFileSync(BACKUP, raw)
	// Keep only the conditions that make sense in a published tarball, in the
	// canonical order: types first (so TS resolves declarations), then import.
	const stripped = {}
	if (dot.types) stripped.types = dot.types
	if (dot.import) stripped.import = dot.import
	pkg.exports["."] = stripped
	// publishConfig.exports was the (never-applied) npm override; it is now
	// redundant because `exports` itself is already publish-safe.
	if (pkg.publishConfig && "exports" in pkg.publishConfig) {
		delete pkg.publishConfig.exports
		if (Object.keys(pkg.publishConfig).length === 0) delete pkg.publishConfig
	}
	fs.writeFileSync(PKG_JSON, `${JSON.stringify(pkg, null, 2)}\n`)
	console.log(`prepack-exports: stripped bun/source from ${pkg.name} exports`)
}

const restore = () => {
	if (!fs.existsSync(BACKUP)) {
		console.error(`prepack-exports: no backup at ${BACKUP}; nothing to restore`)
		return
	}
	fs.copyFileSync(BACKUP, PKG_JSON)
	fs.rmSync(BACKUP)
	console.log(`prepack-exports: restored ${PKG_JSON} from backup`)
}

const mode = process.argv[2]
if (mode === "strip") {
	strip()
} else if (mode === "restore") {
	restore()
} else {
	console.error(`prepack-exports: unknown mode "${mode ?? ""}" — expected "strip" or "restore"`)
	process.exit(1)
}
