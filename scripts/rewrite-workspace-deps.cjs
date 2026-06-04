#!/usr/bin/env node
// Rewrite `workspace:*` deps in every @konfig.ts/* package to the
// exact version in the workspace, in preparation for `npm publish`.
//
// Run before publishing to npm. Idempotent.
//
// Why: `workspace:*` is a Bun/pnpm/Yarn-berry protocol that npm doesn't
// understand. Pre-publish, every internal dep declared as
// `workspace:*` must resolve to a real semver pin. Since konfig.ts
// uses lockstep versioning (see docs/versioning.md), the pin is the
// same as the publishing package's own version.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

const _readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const _writeJson = (p, value) =>
  fs.writeFileSync(p, `${JSON.stringify(value, null, "\t")}\n`);

const _rewriteRecord = (rec, version) => {
  if (!rec) return false;
  let changed = false;
  for (const [name, spec] of Object.entries(rec)) {
    if (typeof spec !== "string") continue;
    if (!name.startsWith("@konfig.ts/")) continue;
    if (spec === "workspace:*" || spec === "workspace:^" || spec === "workspace:~") {
      rec[name] = version;
      changed = true;
    }
  }
  return changed;
};

const _rewriteOne = (pkgDir, version) => {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkg = _readJson(pkgJsonPath);
  let touched = false;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    touched = _rewriteRecord(pkg[field], version) || touched;
  }
  if (touched) {
    _writeJson(pkgJsonPath, pkg);
    console.log(`rewrote ${path.relative(REPO_ROOT, pkgJsonPath)}`);
  }
};

const main = () => {
  // Use any one of the packages' version as the lockstep pin; they're
  // all the same.
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
    _rewriteOne(pkgDir, version);
  }
  console.log(`done — pinned every @konfig.ts/* internal dep to ${version}`);
};

main();
