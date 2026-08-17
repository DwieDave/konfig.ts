import { readFileSync } from "node:fs"
import path from "node:path"
import { EXAMPLE_ROOT } from "./snippets"

/**
 * Repository stats rendered on the landing page. `.github/badges/stats.json` is
 * written by `bun run repo badges` (part of `bun run test:coverage`); the Pages
 * workflow regenerates it before building so the deployed numbers are current.
 */
export interface RepoStats {
  readonly tests: number
  readonly lineCoverage: number
  readonly effectVersion: string
  readonly packages: number
}

const REPO_ROOT = path.resolve(EXAMPLE_ROOT, "..", "..")

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

const parseStats = (raw: unknown, file: string): RepoStats => {
  if (!isRecord(raw)) throw new Error(`${file}: expected an object`)
  const { tests, lineCoverage, effectVersion, packages } = raw
  if (typeof tests !== "number" || typeof lineCoverage !== "number" || typeof effectVersion !== "string" || typeof packages !== "number") {
    throw new Error(`${file}: expected { tests, lineCoverage, effectVersion, packages }`)
  }
  return { tests, lineCoverage, effectVersion, packages }
}

export const readRepoStats = (): RepoStats => {
  const file = path.join(REPO_ROOT, ".github", "badges", "stats.json")
  return parseStats(JSON.parse(readFileSync(file, "utf8")), file)
}

export const readCoreVersion = (): string => {
  const file = path.join(REPO_ROOT, "packages", "core", "package.json")
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"))
  if (!isRecord(raw) || typeof raw["version"] !== "string") throw new Error(`${file}: missing version`)
  return raw["version"]
}
