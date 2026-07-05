#!/usr/bin/env node
// Bump every published @konfig.ts/* package (and the private root, for humans)
// to a target version, in lockstep. Private packages UNDER packages/ (e.g. oxc)
// keep their own version — they are never published and the release tag→version
// check skips them.
//
// Usage:
//   node scripts/bump-version.mjs 0.0.3        # set an explicit version
//   node scripts/bump-version.mjs 1.0.0-rc.1   # explicit prerelease
//   node scripts/bump-version.mjs patch        # x.y.(z+1) from the current version
//   node scripts/bump-version.mjs minor        # x.(y+1).0
//   node scripts/bump-version.mjs major        # (x+1).0.0
//
// Formatting of each package.json is preserved (only the version value changes).
// Syncs bun.lock afterward so CI's `bun install --frozen-lockfile` stays green.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const _readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// Replace ONLY the first top-level "version" field, preserving all formatting.
const _setVersion = (pkgJsonPath, version) => {
  const raw = fs.readFileSync(pkgJsonPath, "utf8");
  const next = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  if (next === raw) return false;
  fs.writeFileSync(pkgJsonPath, next);
  return true;
};

const _resolveTarget = (arg, current) => {
  if (SEMVER_RE.test(arg)) return arg; // explicit version
  if (arg !== "major" && arg !== "minor" && arg !== "patch") {
    console.error(`error: expected an explicit x.y.z version or one of major|minor|patch, got "${arg}"`);
    process.exit(1);
  }
  const m = SEMVER_RE.exec(current);
  if (!m) {
    console.error(`error: current version "${current}" is not x.y.z; cannot ${arg}-bump`);
    process.exit(1);
  }
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (arg === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (arg === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
};

const main = () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: node scripts/bump-version.mjs <version | major | minor | patch>");
    process.exit(1);
  }

  // Lockstep: core is the canonical current version.
  const current = _readJson(path.join(PACKAGES_DIR, "core", "package.json")).version;
  const target = _resolveTarget(arg, current);
  if (!SEMVER_RE.test(target)) {
    console.error(`error: computed target "${target}" is not valid semver`);
    process.exit(1);
  }
  console.log(`bumping ${current} → ${target}`);

  // Root (private): track the release version for humans.
  if (_setVersion(path.join(REPO_ROOT, "package.json"), target)) {
    console.log("  bumped package.json (root)");
  }

  // Every NON-private package under packages/.
  let published = 0;
  for (const entry of fs.readdirSync(PACKAGES_DIR).sort()) {
    const pkgJsonPath = path.join(PACKAGES_DIR, entry, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    if (_readJson(pkgJsonPath).private === true) {
      console.log(`  skip (private): packages/${entry}`);
      continue;
    }
    if (_setVersion(pkgJsonPath, target)) {
      console.log(`  bumped packages/${entry} → ${target}`);
      published += 1;
    }
  }
  console.log(`bumped ${published} published packages + root`);

  // Keep bun.lock in sync so CI's --frozen-lockfile stays green.
  try {
    execFileSync("bun", ["install"], { cwd: REPO_ROOT, stdio: "inherit" });
  } catch (err) {
    console.warn(`warning: 'bun install' failed (${err.message}); run it manually to sync bun.lock`);
  }

  console.log(`\ndone. next:`);
  console.log(`  git add -A && git commit -m "chore(release): bump published packages to ${target}"`);
  console.log(`  git tag -a v${target} -m "Release v${target}"`);
  console.log(`  git push origin main && git push origin v${target}`);
};

main();
