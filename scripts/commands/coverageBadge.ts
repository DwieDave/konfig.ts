import { Console, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Command } from "effect/unstable/cli"
import { readJson, REPO_ROOT, RepoScriptError } from "../lib/repo"

const PACKAGES = [
  "core",
  "env",
  "k8s",
  "external-secrets",
  "sealed-secrets",
  "sops",
  "argocd",
  "docker",
  "cli"
]

const CoverageSummary = Schema.Struct({
  total: Schema.Struct({
    lines: Schema.Struct({
      total: Schema.Number,
      covered: Schema.Number
    })
  })
})

const _badgeSvg = (pct: number) => {
  const label = `${pct.toFixed(1)}%`
  const color = pct >= 90 ? "#4c1" : pct >= 75 ? "#a3c51c" : pct >= 60 ? "#dfb317" : "#e05d44"
  const labelText = "line coverage"
  const labelWidth = 86
  const valueWidth = 12 + label.length * 7
  const width = labelWidth + valueWidth
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${labelText}: ${label}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${labelText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${label}</text>
  </g>
</svg>
`
}

export const coverageBadgeCommand = Command.make(
  "coverage-badge",
  {},
  () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      let total = 0
      let covered = 0
      for (const p of PACKAGES) {
        const file = path.join(REPO_ROOT, "packages", p, "coverage", "coverage-summary.json")
        const parsed = yield* readJson(file)
        const summary = yield* Schema.decodeUnknownEffect(CoverageSummary)(parsed).pipe(
          Effect.mapError((cause) => new RepoScriptError({ message: `unexpected coverage summary shape in ${file}`, cause }))
        )
        total += summary.total.lines.total
        covered += summary.total.lines.covered
      }

      const pct = total === 0 ? 0 : (covered / total) * 100
      const outDir = path.join(REPO_ROOT, ".github", "badges")
      const outFile = path.join(outDir, "coverage.svg")
      yield* fs
        .makeDirectory(outDir, { recursive: true })
        .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot create ${outDir}`, cause })))
      yield* fs
        .writeFileString(outFile, _badgeSvg(pct))
        .pipe(Effect.mapError((cause) => new RepoScriptError({ message: `cannot write ${outFile}`, cause })))
      yield* Console.log(`line coverage ${pct.toFixed(1)}% (${covered}/${total}) -> .github/badges/coverage.svg`)
    })
).pipe(
  Command.withDescription("Aggregate per-package vitest line coverage and render the README badge SVG")
)
