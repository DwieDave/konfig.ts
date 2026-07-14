import { ChildProcess } from "./_unstable"

export interface HelmPullChart {
  readonly repo: string
  readonly chart: string
  readonly version: string
}

export interface HelmPullOptions {
  readonly destination: string
  readonly untar?: boolean
}

/**
 * Builds the `helm pull` argv shared by chart-tarball fetching
 * (helmFetch) and CRD extraction (crd/extract). Callers must pass
 * schema-validated chart fields (see chartSchemas.ts) — this helper
 * does no validation of its own.
 */
export interface HelmPullCommandInput {
  readonly chart: HelmPullChart
  readonly options: HelmPullOptions
}

export const helmPullCommand = ({ chart, options }: HelmPullCommandInput) =>
  ChildProcess.make("helm", [
    "pull",
    "--repo",
    chart.repo,
    chart.chart,
    "--version",
    chart.version,
    ...(options.untar ? ["--untar"] : []),
    "--destination",
    options.destination
  ])
