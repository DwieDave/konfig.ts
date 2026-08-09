import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const packages = [
  "core",
  "env",
  "k8s",
  "external-secrets",
  "sealed-secrets",
  "sops",
  "argocd",
  "docker",
  "cli",
]

let total = 0
let covered = 0
for (const p of packages) {
  const summary = JSON.parse(
    readFileSync(`packages/${p}/coverage/coverage-summary.json`, "utf8"),
  )
  total += summary.total.lines.total
  covered += summary.total.lines.covered
}

const pct = total === 0 ? 0 : (covered / total) * 100
const label = `${pct.toFixed(1)}%`
const color = pct >= 90 ? "#4c1" : pct >= 75 ? "#a3c51c" : pct >= 60 ? "#dfb317" : "#e05d44"

const labelText = "line coverage"
const labelWidth = 86
const valueWidth = 12 + label.length * 7
const width = labelWidth + valueWidth

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${labelText}: ${label}">
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

mkdirSync(".github/badges", { recursive: true })
writeFileSync(".github/badges/coverage.svg", svg)
console.log(`line coverage ${label} (${covered}/${total}) -> .github/badges/coverage.svg`)
