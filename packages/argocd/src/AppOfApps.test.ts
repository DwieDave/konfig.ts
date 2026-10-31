import { it as effectIt } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Application, AppOfApps, AppOfAppsResult, Sync } from "./index"

const target: AppOfApps.AppOfAppsTarget = {
  repoURL: "ssh://git@github.com/example/infra.git",
  branch: "main",
  rootPath: "./infra/k8s/manifests/prod"
}

const defaults: AppOfApps.AppOfAppsDefaults = {
  destination: { server: "https://kubernetes.default.svc" }
}

const _appSource = (name: string): Application.ArgoSource => ({
  repoURL: target.repoURL ?? "",
  targetRevision: target.branch ?? "",
  path: `${target.rootPath ?? ""}/${name}`
})

describe("Application.make", () => {
  it("builds an Application with the given name/namespace", () => {
    const app = Application.make({
      name: "sops-secrets-operator",
      namespace: "argocd",
      manifests: [],
      source: _appSource("sops-secrets-operator"),
      syncPolicy: { automated: { prune: false, selfHeal: false } },
      annotations: Sync.wave(-1)
    })

    expect(app.name).toBe("sops-secrets-operator")
    expect(app.namespace).toBe("argocd")
    expect(app.annotations).toEqual({ "argocd.argoproj.io/sync-wave": "-1" })
    expect(app.syncPolicy).toEqual({ automated: { prune: false, selfHeal: false } })
  })

  it("omits annotations/syncPolicy when not provided", () => {
    const app = Application.make({
      name: "minimal",
      namespace: "default",
      manifests: [],
      source: _appSource("minimal")
    })

    expect(app.annotations).toBeUndefined()
    expect(app.syncPolicy).toBeUndefined()
  })
})

describe("AppOfApps.make", () => {
  it("builds an AppOfApps with the given apps", () => {
    const certManager = Application.make({
      name: "cert-manager",
      namespace: "cert-manager",
      manifests: [],
      source: _appSource("cert-manager")
    })

    const web = Application.make({
      name: "web",
      namespace: "web",
      manifests: [],
      source: _appSource("web")
    })

    const aoa = AppOfApps.make({ target, defaults, apps: [certManager, web] })
    expect(aoa.apps).toHaveLength(2)
    expect(aoa.target.branch).toBe("main")
    expect(aoa.defaults.destination?.server).toBe("https://kubernetes.default.svc")
  })
})

describe("AppOfAppsResult schema", () => {
  const decode = Schema.decodeUnknownEffect(AppOfAppsResult)

  effectIt.effect("keeps the 0.4.0 target fields when present", () =>
    Effect.gen(function*() {
      const result = yield* decode({ name: "apps", target, defaults, apps: [] })

      expect(result.target).toEqual(target)
    }))

  effectIt.effect("accepts a target without the 0.4.0 fields", () =>
    Effect.gen(function*() {
      const result = yield* decode({ name: "apps", target: { controllerNamespace: "ops" }, defaults, apps: [] })

      expect(result.target).toEqual({ controllerNamespace: "ops" })
    }))
})
