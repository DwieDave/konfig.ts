#!/usr/bin/env node
// Rewrite non-npm dependency protocols in every @konfig.ts/* package to
// concrete versions, in preparation for `npm publish`.
//
//   - `workspace:*`  → the lockstep version of the published package set
//   - `catalog:`     → the version from the root package.json `catalog`
//                      (Bun/pnpm catalog protocol; a named `catalog:<group>`
//                      resolves from the root `catalogs` table)
//
// Run before publishing. Idempotent. npm understands NEITHER protocol, so a
// published tarball must carry real semver — a `catalog:` (or `workspace:*`)
// specifier that survives into a runtime dependency is an install-time hard
// failure for every consumer.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

const _readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const _writeJson = (p, value) =>
  fs.writeFileSync(p, `${JSON.stringify(value, null, "\t")}\n`);

const _resolveCatalog = (name, spec, catalog, namedCatalogs, pkgJsonPath) => {
  const group = spec.slice("catalog:".length); // "" == the default catalog
  const table = group === "" ? catalog : namedCatalogs[group] || {};
  const resolved = table[name];
  if (!resolved) {
    console.error(
      `error: ${path.relative(REPO_ROOT, pkgJsonPath)}: no catalog entry for "${name}" (spec "${spec}")`,
    );
    process.exit(1);
  }
  return resolved;
};

const _rewriteRecord = (rec, version, catalog, namedCatalogs, pkgJsonPath) => {
  if (!rec) return false;
  let changed = false;
  for (const [name, spec] of Object.entries(rec)) {
    if (typeof spec !== "string") continue;
    if (
      name.startsWith("@konfig.ts/")
      && (spec === "workspace:*" || spec === "workspace:^" || spec === "workspace:~")
    ) {
      rec[name] = version;
      changed = true;
    } else if (spec === "catalog:" || spec.startsWith("catalog:")) {
      rec[name] = _resolveCatalog(name, spec, catalog, namedCatalogs, pkgJsonPath);
      changed = true;
    }
  }
  return changed;
};

const _rewriteOne = (pkgDir, version, catalog, namedCatalogs) => {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkg = _readJson(pkgJsonPath);
  let touched = false;
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    touched = _rewriteRecord(pkg[field], version, catalog, namedCatalogs, pkgJsonPath) || touched;
  }
  if (touched) {
    _writeJson(pkgJsonPath, pkg);
    console.log(`rewrote ${path.relative(REPO_ROOT, pkgJsonPath)}`);
  }
};

const main = () => {
  const rootPkg = _readJson(path.join(REPO_ROOT, "package.json"));
  const catalog = rootPkg.catalog || {};
  const namedCatalogs = rootPkg.catalogs || {};

  // Use core's version as the lockstep pin; every published package shares it.
  const corePkgJson = _readJson(path.join(PACKAGES_DIR, "core", "package.json"));
  const version = corePkgJson.version;
  if (!version || version === "0.0.0") {
    console.error(`error: refusing to rewrite — @konfig.ts/core version is "${version}"`);
    process.exit(1);
  }
  for (const entry of fs.readdirSync(PACKAGES_DIR)) {
    const pkgDir = path.join(PACKAGES_DIR, entry);
    if (!fs.statSync(pkgDir).isDirectory()) continue;
    if (!fs.existsSync(path.join(pkgDir, "package.json"))) continue;
    _rewriteOne(pkgDir, version, catalog, namedCatalogs);
  }
  console.log(`done — resolved workspace:* and catalog: deps to concrete versions (v${version})`);
};

main();
