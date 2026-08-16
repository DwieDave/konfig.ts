export const SITE = {
  title: "konfig.ts | Typesafe Kubernetes + ArgoCD in TypeScript",
  description:
    "Kubernetes config that fails at tsc, not at argocd sync. Typesafe Kubernetes + ArgoCD manifests in TypeScript, powered by Effect.",
  repo: "https://github.com/DwieDave/konfig.ts",
  npm: "https://www.npmjs.com/package/@konfig.ts/core",
  releases: "https://github.com/DwieDave/konfig.ts/releases",
  example: "https://github.com/DwieDave/konfig.ts/tree/main/examples/full-stack",
  version: "0.0.10",
  effectVersion: "4.0.0-rc",
  author: "@DwieDave"
} as const

export const base = import.meta.env.BASE_URL.replace(/\/$/, "")

export const PACKAGES: ReadonlyArray<{ readonly name: string; readonly blurb: string; readonly dir: string }> = [
  { name: "@konfig.ts/core", dir: "core", blurb: "Manifest<A>, Dep.*, Module, Helm.release, stable YAML, structural diff" },
  { name: "@konfig.ts/k8s", dir: "k8s", blurb: "Builders with branded refs; Container.define; Workload.web / .cron" },
  { name: "@konfig.ts/env", dir: "env", blurb: "Secret / Literal / Downward .define; Environment.define + runtime decoder" },
  { name: "@konfig.ts/argocd", dir: "argocd", blurb: "Application.define, AppOfApps.fromModules / entrypoint, Sync.wave" },
  { name: "@konfig.ts/sops", dir: "sops", blurb: "SopsSecret backend + source; fail-closed on plaintext" },
  { name: "@konfig.ts/sealed-secrets", dir: "sealed-secrets", blurb: "SealedSecret backend; kubeseal stdout schema-validated" },
  { name: "@konfig.ts/external-secrets", dir: "external-secrets", blurb: "ExternalSecret backend; no source required" },
  { name: "@konfig.ts/docker", dir: "docker", blurb: "Workspace-graph-aware Dockerfile generator" },
  { name: "@konfig.ts/cli", dir: "cli", blurb: "build · validate · diff · set · crd · helm · docker · graph" }
]
