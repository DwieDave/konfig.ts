import { Console, Effect, Schema } from "effect"
import { Command } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { renderBadge } from "../lib/badge"
import { coveragePackageNames, mapRepoError, readJson, readRootCatalogs, REPO_ROOT, RepoScriptError } from "../lib/repo"

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

export const coverageColor = (pct: number) =>
  pct >= 90 ? "#4c1" : pct >= 75 ? "#a3c51c" : pct >= 60 ? "#dfb317" : "#e05d44"

const _writeBadge = (input: { readonly file: string; readonly content: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs
      .writeFileString(input.file, input.content)
      .pipe(mapRepoError(`cannot write ${input.file}`))
  })

const _readDecoded = <S extends Schema.Decoder<unknown>>(input: {
  readonly schema: S
  readonly file: string
  readonly what: string
}) =>
  Effect.gen(function*() {
    const json = yield* readJson(input.file)

    return yield* Schema.decodeEffect(input.schema)(json).pipe(
      mapRepoError(`unexpected ${input.what} shape in ${input.file}`)
    )
  })

interface _Totals {
  readonly linesTotal: number
  readonly linesCovered: number
  readonly tests: number
}

const _readPackageTotals = (name: string) =>
  Effect.gen(function*() {
    const path = yield* Path
    const dir = path.join(REPO_ROOT, "packages", name, "coverage")

    const cov = yield* _readDecoded({
      schema: CoverageSummary,
      file: path.join(dir, "coverage-summary.json"),
      what: "coverage summary"
    })

    const results = yield* _readDecoded({
      schema: TestResults,
      file: path.join(dir, "test-results.json"),
      what: "test results"
    })

    return {
      linesTotal: cov.total.lines.total,
      linesCovered: cov.total.lines.covered,
      tests: results.numTotalTests
    } satisfies _Totals
  })

const _sumTotals = (all: ReadonlyArray<_Totals>): _Totals => ({
  linesTotal: all.reduce((n, t) => n + t.linesTotal, 0),
  linesCovered: all.reduce((n, t) => n + t.linesCovered, 0),
  tests: all.reduce((n, t) => n + t.tests, 0)
})

const _collectTotals = coveragePackageNames.pipe(
  Effect.flatMap((names) => Effect.forEach(names, _readPackageTotals)),
  Effect.map(_sumTotals)
)

const _readEffectVersion = Effect.gen(function*() {
  const { catalog } = yield* readRootCatalogs
  const effectVersion = catalog.effect

  if (effectVersion === undefined) {
    return yield* new RepoScriptError({ message: "no effect entry in the root catalog" })
  }

  return effectVersion
})

export const writeAllBadges = (input: {
  readonly outDir: string
  readonly pct: number
  readonly tests: number
  readonly effectVersion: string
  readonly stats: RepoStats
}) =>
  Effect.gen(function*() {
    const path = yield* Path
    const out = (name: string) => path.join(input.outDir, name)
    yield* _writeBadge({
      file: out("coverage.svg"),
      content: renderBadge({
        label: "line coverage",
        value: `${input.pct.toFixed(1)}%`,
        color: coverageColor(input.pct)
      })
    })
    yield* _writeBadge({
      file: out("tests.svg"),
      content: renderBadge({ label: "tests", value: `${input.tests}`, color: "#007ec6" })
    })
    yield* _writeBadge({
      file: out("effect.svg"),
      content: renderBadge({ label: "effect", value: input.effectVersion, color: "#312e81" })
    })
    yield* _writeBadge({ file: out("stats.json"), content: `${JSON.stringify(input.stats, null, 2)}\n` })
  })

const _runBadges = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const { linesTotal, linesCovered, tests } = yield* _collectTotals
  const effectVersion = yield* _readEffectVersion
  const pct = linesTotal === 0 ? 0 : (linesCovered / linesTotal) * 100
  const outDir = path.join(REPO_ROOT, ".github", "badges")
  yield* fs.makeDirectory(outDir, { recursive: true }).pipe(mapRepoError(`cannot create ${outDir}`))
  const packages = (yield* coveragePackageNames).length
  const stats = makeStats({ tests, linesCovered, linesTotal, effectVersion, packages })
  yield* writeAllBadges({ outDir, pct, tests, effectVersion, stats })
  yield* Console.log(`line coverage ${pct.toFixed(1)}% (${linesCovered}/${linesTotal})`)
  yield* Console.log(`tests ${tests}`)
  yield* Console.log(`effect ${effectVersion}`)
  yield* Console.log(`wrote coverage.svg, tests.svg, effect.svg, stats.json -> .github/badges/`)
})

export const badgesCommand = Command.make("badges", {}, () => _runBadges).pipe(
  Command.withDescription(
    "Render the README badges (line coverage, test count, effect version) and stats.json from local data"
  )
)
