import { NodeServices } from "@effect/platform-node"
import { layer } from "@effect/vitest"
import { RenderContext, renderManifest } from "@konfig.ts/core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  Application,
  applicationCRFilename,
  type AppOfApps,
  emitApplicationCR,
  serializeApplicationCR,
  Sync
} from "./index"

const ctx = RenderContext.make("test")

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

    expect(
      serializeApplicationCR({
        app: Application.make({ ...base, project: "team-a" }),
        target,
        defaults
      })
    ).toContain("project: team-a")

    expect(
      serializeApplicationCR({
        app: Application.make(base),
        target,
        defaults: { ...defaults, project: "team-b" }
      })
    ).toContain("project: team-b")

    expect(serializeApplicationCR({ app: Application.make(base), target, defaults })).toContain(
      "project: default"
    )
  })
})

describe("syncPolicy merge (defaults + app both defined)", () => {
  const appBase = {
    name: "merge-target",
    namespace: "argocd",
    manifests: [],
    source: {
      repoURL: "ssh://git@github.com/example/infra.git",
      targetRevision: "main",
      path: "./infra/k8s/manifests/prod/merge-target"
    }
  } as const

  it("deep-merges automated field-by-field instead of clobbering the default", () => {
    const app = Application.make({
      ...appBase,
      syncPolicy: { automated: { prune: false } }
    })
    const withDefaults: AppOfApps.AppOfAppsDefaults = {
      ...defaults,
      syncPolicy: { automated: { selfHeal: true, allowEmpty: true } }
    }

    const yaml = serializeApplicationCR({ app, target, defaults: withDefaults })

    // app-level prune:false must win, but default selfHeal:true / allowEmpty:true
    // must survive instead of being wholesale replaced.
    expect(yaml).toContain("prune: false")
    expect(yaml).toContain("selfHeal: true")
    expect(yaml).toContain("allowEmpty: true")
  })

  it("deep-merges retry (including nested backoff) field-by-field", () => {
    const app = Application.make({
      ...appBase,
      syncPolicy: { retry: { limit: 3, backoff: { duration: "5s" } } }
    })
    const withDefaults: AppOfApps.AppOfAppsDefaults = {
      ...defaults,
      syncPolicy: { retry: { backoff: { factor: 2, maxDuration: "3m" } } }
    }

    const yaml = serializeApplicationCR({ app, target, defaults: withDefaults })

    expect(yaml).toContain("limit: 3")
    expect(yaml).toContain("duration: 5s")
    expect(yaml).toContain("factor: 2")
    expect(yaml).toContain("maxDuration: 3m")
  })

  it("app-level syncOptions replaces (not merges with) the default array", () => {
    const app = Application.make({
      ...appBase,
      syncPolicy: { syncOptions: ["CreateNamespace=true"] }
    })
    const withDefaults: AppOfApps.AppOfAppsDefaults = {
      ...defaults,
      syncPolicy: { syncOptions: ["Validate=false"] }
    }

    const yaml = serializeApplicationCR({ app, target, defaults: withDefaults })

    expect(yaml).toContain("CreateNamespace=true")
    expect(yaml).not.toContain("Validate=false")
  })
})

describe("emitApplicationCR", () => {
  layer(NodeServices.layer)("rendering", (it) => {
    it.effect("renders the same YAML as serializeApplicationCR", () =>
      Effect.gen(function*() {
        const app = Application.make({
          name: "sops-secrets-operator",
          namespace: "argocd",
          manifests: [],
          source: {
            repoURL: "ssh://git@github.com/example/infra.git",
            targetRevision: "main",
            path: "./infra/k8s/manifests/prod/sops-secrets-operator"
          },
          syncPolicy: { automated: { prune: false, selfHeal: false } }
        })

        const manifest = emitApplicationCR({ app, target, defaults })
        const out = yield* renderManifest({ manifest, ctx })

        expect(out).toBe(serializeApplicationCR({ app, target, defaults }))
        expect(out).toContain("kind: Application")
        expect(out).toContain("name: sops-secrets-operator")
      }))
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

  it("sanitizes '.' and '/' out of the name, like core's filenameFor", () => {
    const app = Application.make({
      name: "sub/app.v2",
      namespace: "argocd",
      manifests: [],
      source: { repoURL: "", targetRevision: "", path: "" }
    })
    expect(applicationCRFilename(app)).toBe("Application-sub-app-v2.yaml")
  })
})
