// Single source of truth for the Helm/CRD/charts defaults and the env var
// names that override them. Both the `konfig.json` schema (konfigConfig.ts,
// this package) and the CLI's path resolver (cliConfig.ts, @konfig.ts/cli)
// import from here so the two never drift apart — see AGENTS.md task on
// unifying konfig.json as the source of truth for these paths.

export const DEFAULT_HELM_CACHE_DIR = ".konfig/helm-cache"
export const DEFAULT_HELM_MIN_VERSION = "3.16.0"
export const DEFAULT_CRD_OUT_DIR = ".generated/crd"
// Historically diverged from konfigConfig.ts's schema default ("charts");
// this is now the single value both use.
export const DEFAULT_CHARTS_DIR = "infra/k8s-konfig/charts"

export const KONFIG_HELM_CACHE_ENV = "KONFIG_HELM_CACHE"
export const KONFIG_HELM_MIN_VERSION_ENV = "KONFIG_HELM_MIN_VERSION"
export const KONFIG_CRD_OUT_DIR_ENV = "KONFIG_CRD_OUT_DIR"
export const KONFIG_CHARTS_DIR_ENV = "KONFIG_CHARTS_DIR"
