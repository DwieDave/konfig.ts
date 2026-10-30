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

export const coverageColor = (pct: number) =>
  pct >= 90 ? "#4c1" : pct >= 75 ? "#a3c51c" : pct >= 60 ? "#dfb317" : "#e05d44"

const _writeBadge = (input: { readonly file: string; readonly svg: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs
      .writeFileString(input.file, input.svg)
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

const _collectTotals = Effect.gen(function*() {
  const path = yield* Path
  let linesTotal = 0
  let linesCovered = 0
  let tests = 0
  for (const p of yield* coveragePackageNames) {
    const dir = path.join(REPO_ROOT, "packages", p, "coverage")
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
    linesTotal += cov.total.lines.total
    linesCovered += cov.total.lines.covered
    tests += results.numTotalTests
  }
  return { linesTotal, linesCovered, tests }
})

const _readEffectVersion = Effect.gen(function*() {
  const path = yield* Path
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
  return effectVersion
})

export const _writeAllBadges = (input: {
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
      svg: renderBadge({
        label: "line coverage",
        value: `${input.pct.toFixed(1)}%`,
        color: coverageColor(input.pct)
      })
    })
    yield* _writeBadge({
      file: out("tests.svg"),
      svg: renderBadge({ label: "tests", value: `${input.tests}`, color: "#007ec6" })
    })
    yield* _writeBadge({
      file: out("effect.svg"),
      svg: renderBadge({ label: "effect", value: input.effectVersion, color: "#312e81" })
    })
    yield* _writeBadge({ file: out("stats.json"), svg: `${JSON.stringify(input.stats, null, 2)}\n` })
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
  yield* _writeAllBadges({ outDir, pct, tests, effectVersion, stats })
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
