import { Console, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Command } from "effect/unstable/cli"
import { renderBadge } from "../lib/badge"
import { readJson, REPO_ROOT, RepoScriptError, testPackageNames } from "../lib/repo"

const CoverageSummary = Schema.Struct({
  total: Schema.Struct({
    lines: Schema.Struct({
      total: Schema.Number,
      covered: Schema.Number
    })
  })
})

const TestResults = Schema.Struct({
  numTotalTests: Schema.Number,
  numPassedTests: Schema.Number
})

const _coverageColor = (pct: number) =>
  pct >= 90 ? "#4c1" : pct >= 75 ? "#a3c51c" : pct >= 60 ? "#dfb317" : "#e05d44"

const _writeBadge = (input: { readonly file: string; readonly svg: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs
      .writeFileString(input.file, input.svg)
      .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot write ${input.file}`, cause })))
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
      for (const p of yield* testPackageNames) {
        const covFile = path.join(REPO_ROOT, "packages", p, "coverage", "coverage-summary.json")
        const cov = yield* Schema.decodeUnknownEffect(CoverageSummary)(yield* readJson(covFile)).pipe(
          Effect.mapError((cause) => new RepoScriptError({ message: `unexpected coverage summary shape in ${covFile}`, cause }))
        )
        linesTotal += cov.total.lines.total
        linesCovered += cov.total.lines.covered

        const resultsFile = path.join(REPO_ROOT, "packages", p, "coverage", "test-results.json")
        const results = yield* Schema.decodeUnknownEffect(TestResults)(yield* readJson(resultsFile)).pipe(
          Effect.mapError((cause) => new RepoScriptError({ message: `unexpected test results shape in ${resultsFile}`, cause }))
        )
        tests += results.numTotalTests
      }

      const rootPkg = yield* readJson(path.join(REPO_ROOT, "package.json"))
      const catalog = rootPkg.catalog as Record<string, string> | undefined
      const effectVersion = catalog?.effect
      if (effectVersion === undefined) {
        return yield* new RepoScriptError({ message: "no effect entry in the root catalog" })
      }

      const pct = linesTotal === 0 ? 0 : (linesCovered / linesTotal) * 100
      const outDir = path.join(REPO_ROOT, ".github", "badges")
      yield* fs
        .makeDirectory(outDir, { recursive: true })
        .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot create ${outDir}`, cause })))

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

      yield* Console.log(`line coverage ${pct.toFixed(1)}% (${linesCovered}/${linesTotal})`)
      yield* Console.log(`tests ${tests}`)
      yield* Console.log(`effect ${effectVersion}`)
      yield* Console.log(`wrote coverage.svg, tests.svg, effect.svg -> .github/badges/`)
    })
).pipe(
  Command.withDescription("Render the README badges (line coverage, test count, effect version) from local data")
)
