import { z } from "astro/zod"
import { readFileSync } from "node:fs"
import path from "node:path"
import { EXAMPLE_ROOT } from "./snippets"

/**
 * Repository stats rendered on the landing page. `.github/badges/stats.json` is
 * written by `bun run repo badges` (part of `bun run test:coverage`); the Pages
 * workflow regenerates it before building so the deployed numbers are current.
 */
const RepoStatsSchema = z.object({
  tests: z.number(),
  lineCoverage: z.number(),
  effectVersion: z.string(),
  packages: z.number()
})

type RepoStats = z.infer<typeof RepoStatsSchema>

const CorePackageSchema = z.object({ version: z.string() })

const REPO_ROOT = path.resolve(EXAMPLE_ROOT, "..", "..")

const parseFile = <S extends z.ZodType>(input: { readonly schema: S; readonly file: string }): z.infer<S> => {
  const parsed = input.schema.safeParse(JSON.parse(readFileSync(input.file, "utf8")))

  if (!parsed.success) throw new Error(`${input.file}: ${z.prettifyError(parsed.error)}`)

  return parsed.data
}

export const readRepoStats = (): RepoStats =>
  parseFile({ schema: RepoStatsSchema, file: path.join(REPO_ROOT, ".github", "badges", "stats.json") })

export const readCoreVersion = (): string =>
  parseFile({ schema: CorePackageSchema, file: path.join(REPO_ROOT, "packages", "core", "package.json") }).version
