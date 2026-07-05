import { describe, expect, it } from "vitest"
import { Application, applicationCRFilename, type AppOfApps, serializeApplicationCR, Sync } from "./index"

const target: AppOfApps.AppOfAppsTarget = {
  repoURL: "ssh://git@github.com/example/infra.git",
  branch: "main",
  rootPath: "./infra/k8s/manifests/prod"
}

const defaults: AppOfApps.AppOfAppsDefaults = {
  destination: { server: "https://kubernetes.default.svc" }
}

describe("serializeApplicationCR", () => {
  it("produces YAML that matches nixidy output for sops-secrets-operator", () => {
    const app = Application.make({
      name: "sops-secrets-operator",
      namespace: "argocd",
      manifests: [],
      source: {
        repoURL: "ssh://git@github.com/example/infra.git",
        targetRevision: "main",
        path: "./infra/k8s/manifests/prod/sops-secrets-operator"
      },
      syncPolicy: { automated: { prune: false, selfHeal: false } },
      annotations: Sync.wave(-1)
    })

    const yaml = serializeApplicationCR({ app, target, defaults })

    expect(yaml).toContain("apiVersion: argoproj.io/v1alpha1")
    expect(yaml).toContain("kind: Application")
    expect(yaml).toContain("name: sops-secrets-operator")
    expect(yaml).toContain("namespace: argocd")
    expect(yaml).toContain("argocd.argoproj.io/sync-wave: \"-1\"")
    expect(yaml).toContain("server: https://kubernetes.default.svc")
    expect(yaml).toContain("project: default")
    expect(yaml).toContain("repoURL: ssh://git@github.com/example/infra.git")
    expect(yaml).toContain("targetRevision: main")
    expect(yaml).toContain("path: ./infra/k8s/manifests/prod/sops-secrets-operator")
  })

  it("produces YAML matching nixidy output for api (with sync-wave 1)", () => {
    const app = Application.make({
      name: "api",
      namespace: "prod",
      manifests: [],
      source: {
        repoURL: "ssh://git@github.com/example/infra.git",
        targetRevision: "main",
        path: "./infra/k8s/manifests/prod/api"
      },
      syncPolicy: { automated: { prune: false, selfHeal: false } },
      annotations: Sync.wave(1)
    })

    const yaml = serializeApplicationCR({ app, target, defaults })
    expect(yaml).toContain("argocd.argoproj.io/sync-wave: \"1\"")
    expect(yaml).toContain("namespace: prod")
    expect(yaml).toContain("path: ./infra/k8s/manifests/prod/api")
  })

  it("omits annotations block when none provided", () => {
    const app = Application.make({
      name: "minimal",
      namespace: "argocd",
      manifests: [],
      source: {
        repoURL: "ssh://git@github.com/example/infra.git",
        targetRevision: "main",
        path: "./infra/k8s/manifests/prod/minimal"
      }
    })

    const yaml = serializeApplicationCR({ app, target, defaults })
    expect(yaml).not.toContain("annotations:")
    expect(yaml).not.toContain("syncPolicy:")
  })

  it("includes syncPolicy block when provided", () => {
    const app = Application.make({
      name: "with-sync",
      namespace: "argocd",
      manifests: [],
      source: {
        repoURL: "ssh://git@github.com/example/infra.git",
        targetRevision: "main",
        path: "./infra/k8s/manifests/prod/with-sync"
      },
      syncPolicy: { automated: { prune: true, selfHeal: true } }
    })

    const yaml = serializeApplicationCR({ app, target, defaults })
    expect(yaml).toContain("syncPolicy:")
    expect(yaml).toContain("prune: true")
    expect(yaml).toContain("selfHeal: true")
  })

  it("emits spec.source from app.source when it differs from the target", () => {
    const app = Application.make({
      name: "external",
      namespace: "argocd",
      manifests: [],
      source: {
        repoURL: "ssh://git@github.com/other/charts.git",
        targetRevision: "v1.2.3",
        path: "./charts/external"
      }
    })

    const yaml = serializeApplicationCR({ app, target, defaults })
    expect(yaml).toContain("repoURL: ssh://git@github.com/other/charts.git")
    expect(yaml).toContain("targetRevision: v1.2.3")
    expect(yaml).toContain("path: ./charts/external")
    // must NOT fall back to the parent target-derived values
    expect(yaml).not.toContain("targetRevision: main")
    expect(yaml).not.toContain("path: ./infra/k8s/manifests/prod/external")
  })

  it("emits spec.project from the app override, then defaults, then \"default\"", () => {
    const base = {
      name: "proj",
      namespace: "argocd",
      manifests: [],
      source: {
        repoURL: "ssh://git@github.com/example/infra.git",
        targetRevision: "main",
        path: "./infra/k8s/manifests/prod/proj"
      }
    } as const

    // per-app override wins
    expect(
      serializeApplicationCR({
        app: Application.make({ ...base, project: "team-a" }),
        target,
        defaults
      })
    ).toContain("project: team-a")

    // defaults.project used when app has none
    expect(
      serializeApplicationCR({
        app: Application.make(base),
        target,
        defaults: { ...defaults, project: "team-b" }
      })
    ).toContain("project: team-b")

    // falls back to "default"
    expect(serializeApplicationCR({ app: Application.make(base), target, defaults })).toContain(
      "project: default"
    )
  })
})

describe("applicationCRFilename", () => {
  it("returns Application-<name>.yaml", () => {
    const app = Application.make({
      name: "cert-manager",
      namespace: "argocd",
      manifests: [],
      source: { repoURL: "", targetRevision: "", path: "" }
    })
    expect(applicationCRFilename(app)).toBe("Application-cert-manager.yaml")
  })
})
