import { Schema } from "effect"

const _CHART_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const _CHART_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/
const _CHART_REPO_PATTERN = /^(https?|oci):\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/
const _ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export const ChartName = Schema.String.check(
  Schema.isPattern(_CHART_NAME_PATTERN, {
    description: "Helm chart name (alphanumeric, dot, underscore, dash)"
  })
)

export const ChartVersion = Schema.String.check(
  Schema.isPattern(_CHART_VERSION_PATTERN, {
    description: "Helm chart version (semver-compatible)"
  })
)

export const ChartRepoUrl = Schema.String.check(
  Schema.isPattern(_CHART_REPO_PATTERN, {
    description: "Helm chart repo URL (http(s)/oci scheme, no shell metachars)"
  })
)

export const ChartId = Schema.String.check(
  Schema.isPattern(_ID_PATTERN, {
    description: "Chart release id (alphanumeric, dot, underscore, dash)"
  })
)
