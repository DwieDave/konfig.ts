import { Console, Effect, Schema } from "effect"
import { Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { renderBadge } from "../lib/badge"
import {
  coveragePackageNames,
  decodeField,
  mapRepoError,
  readJson,
  REPO_ROOT,
  RepoScriptError,
  StringRecord
} from "../lib/repo"

const CoverageSummary = Schema.Struct({
  total: Schema.Struct({
    lines: Schema.Struct({
      total: Schema.Finite,
      covered: Schema.Finite
    })
  })
})

const TestResults = Schema.Struct({
  numTotalTests: Schema.Finite,
  numPassedTests: Schema.Finite
})

/** Shape of `.github/badges/stats.json`, consumed by apps/website at build time. */
export const RepoStats = Schema.Struct({
  tests: Schema.Finite,
  lineCoverage: Schema.Finite,
  linesCovered: Schema.Finite,
  linesTotal: Schema.Finite,
  effectVersion: Schema.String,
  packages: Schema.Finite
})
export type RepoStats = typeof RepoStats.Type

export const makeStats = (input: {
  readonly tests: number
  readonly linesCovered: number
  readonly linesTotal: number
  readonly effectVersion: string
  readonly packages: number
}): RepoStats => ({
  tests: input.tests,
  lineCoverage: input.linesTotal === 0 ? 0 : Number(((input.linesCovered / input.linesTotal) * 100).toFixed(1)),
  linesCovered: input.linesCovered,
  linesTotal: input.linesTotal,
  effectVersion: input.effectVersion,
  packages: input.packages
})

const _coverageColor = (pct: number) => pct >= 90 ? "#4c1" : pct >= 75 ? "#a3c51c" : pct >= 60 ? "#dfb317" : "#e05d44"

const _writeBadge = (input: { readonly file: string; readonly svg: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs
      .writeFileString(input.file, input.svg)
      .pipe(mapRepoError(`cannot write ${input.file}`))
  })

export const badgesCommand = Command.make(
  "badges",
  {},
  () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      let linesTotal = 0
      let linesCovered = 0
      let tests = 0
      for (const p of yield* coveragePackageNames) {
        const covFile = path.join(REPO_ROOT, "packages", p, "coverage", "coverage-summary.json")
        const cov = yield* Schema.decodeUnknownEffect(CoverageSummary)(yield* readJson(covFile)).pipe(
          mapRepoError(`unexpected coverage summary shape in ${covFile}`)
        )
        linesTotal += cov.total.lines.total
        linesCovered += cov.total.lines.covered

        const resultsFile = path.join(REPO_ROOT, "packages", p, "coverage", "test-results.json")
        const results = yield* Schema.decodeUnknownEffect(TestResults)(yield* readJson(resultsFile)).pipe(
          mapRepoError(`unexpected test results shape in ${resultsFile}`)
        )
        tests += results.numTotalTests
      }

      const rootPkg = yield* readJson(path.join(REPO_ROOT, "package.json"))
      const catalog = yield* decodeField({
        schema: Schema.UndefinedOr(StringRecord),
        value: rootPkg.catalog,
        what: "root catalog"
      })
      const effectVersion = catalog?.effect
      if (effectVersion === undefined) {
        return yield* new RepoScriptError({ message: "no effect entry in the root catalog" })
      }

      const pct = linesTotal === 0 ? 0 : (linesCovered / linesTotal) * 100
      const outDir = path.join(REPO_ROOT, ".github", "badges")
      yield* fs
        .makeDirectory(outDir, { recursive: true })
        .pipe(mapRepoError(`cannot create ${outDir}`))

      yield* _writeBadge({
        file: path.join(outDir, "coverage.svg"),
        svg: renderBadge({ label: "line coverage", value: `${pct.toFixed(1)}%`, color: _coverageColor(pct) })
      })
      yield* _writeBadge({
        file: path.join(outDir, "tests.svg"),
        svg: renderBadge({ label: "tests", value: `${tests}`, color: "#007ec6" })
      })
      yield* _writeBadge({
        file: path.join(outDir, "effect.svg"),
        svg: renderBadge({ label: "effect", value: effectVersion, color: "#312e81" })
      })

      // Machine-readable copy of the same numbers, consumed by apps/website at build time.
      const packages = (yield* coveragePackageNames).length
      const stats = makeStats({ tests, linesCovered, linesTotal, effectVersion, packages })
      yield* _writeBadge({ file: path.join(outDir, "stats.json"), svg: `${JSON.stringify(stats, null, 2)}\n` })

      yield* Console.log(`line coverage ${pct.toFixed(1)}% (${linesCovered}/${linesTotal})`)
      yield* Console.log(`tests ${tests}`)
      yield* Console.log(`effect ${effectVersion}`)
      yield* Console.log(`wrote coverage.svg, tests.svg, effect.svg, stats.json -> .github/badges/`)
    })
).pipe(
  Command.withDescription(
    "Render the README badges (line coverage, test count, effect version) and stats.json from local data"
  )
)
