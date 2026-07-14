import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { RenderContext, renderManifest, Yaml } from "@konfig.ts/core"
import { Effect } from "effect"
import { ConfigMap, Namespace, Secret, ServiceAccount } from "./identity"

const ctx = RenderContext.make("test")

describe("identity constructors expose .ref for downstream wiring", () => {
  it("Namespace exposes its name as `.ref`", () => {
    const ns = Namespace.make({ name: "api" })
    expect(ns.ref).toBe("api")
  })

  it("ServiceAccount exposes a branded ServiceAccountRef", () => {
    const sa = ServiceAccount.make({ name: "api", namespace: "prod" })
    expect(sa.ref).toBe("api")
  })

  it("ConfigMap exposes a branded ConfigMapRef", () => {
    const cm = ConfigMap.make({ name: "oauth-templates", namespace: "prod" })
    expect(cm.ref).toBe("oauth-templates")
  })

  it("Secret exposes a branded SecretRef", () => {
    const s = Secret.make({ name: "api-creds", namespace: "prod" })
    expect(s.ref).toBe("api-creds")
  })
})

layer(NodeServices.layer)("identity rendering", (it) => {
  it.effect("rendered Namespace matches the nixidy shape", () =>
    Effect.gen(function*() {
      const ns = Namespace.make({
        name: "sops",
        annotations: { "argocd.argoproj.io/sync-options": "Prune=false" }
      })
      const out = yield* renderManifest({ manifest: ns, ctx })
      const yaml = Yaml.serialize({ value: out })
      expect(yaml).toContain("apiVersion: v1")
      expect(yaml).toContain("kind: Namespace")
      expect(yaml).toContain("name: sops")
      expect(yaml).toContain("argocd.argoproj.io/sync-options: Prune=false")
    }))
})
