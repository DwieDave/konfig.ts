import * as fs from "node:fs/promises"
import * as path from "node:path"

export const HELM_RELEASE_MARKER = "_konfigHelmRelease" as const

export interface ChartRegistryEntry {
  readonly id: string
  readonly repo: string
  readonly chart: string
  readonly version: string
  readonly digest: string
}

export const loadChartRegistry = async (
  chartsDir: string
): Promise<ChartRegistryEntry[]> => {
  const entries: ChartRegistryEntry[] = []

  let files: string[]
  try {
    files = await fs.readdir(chartsDir)
  } catch {
    return entries
  }

  for (const file of files.filter((f) => f.endsWith(".ts") && !f.startsWith("_"))) {
    try {
      const mod = await import(path.resolve(chartsDir, file))
      for (const key of Object.keys(mod)) {
        const val = mod[key]
        if (
          val &&
          typeof val === "object" &&
          HELM_RELEASE_MARKER in val &&
          val[HELM_RELEASE_MARKER] === true
        ) {
          entries.push({
            id: String(val.id ?? file.replace(/\.ts$/, "")),
            repo: String(val.repo ?? ""),
            chart: String(val.chart ?? ""),
            version: String(val.version ?? ""),
            digest: String(val.digest ?? "")
          })
          break
        }
      }
    } catch (cause) {
      // A chart module that throws on import (syntax/type error, bad
      // side effect) must not silently vanish from the registry — surface
      // it so the operator can see which file failed and why.
      process.stderr.write(
        `konfig: failed to load chart module ${path.resolve(chartsDir, file)}: ${String(cause)}\n`
      )
    }
  }
  return entries
}
