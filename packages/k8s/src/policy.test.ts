import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { RenderContext } from "@konfig.ts/core"
import { Effect } from "effect"
import { _policyManifest, NetworkPolicy } from "./policy"
import { Selector } from "./selector"

const ctx = RenderContext.make("test")

layer(NodeServices.layer)("_policyManifest", (it) => {
  it.effect("passes the raw spec through unchanged", () =>
    Effect.gen(function*() {
      const np = _policyManifest({
        name: "deny-all",
        namespace: "prod",
        spec: { podSelector: {}, policyTypes: ["Ingress"] }
      })

      const result = yield* np.render(ctx)
      expect(result.kind).toBe("NetworkPolicy")
      expect(result.apiVersion).toBe("networking.k8s.io/v1")
      expect(result.spec).toEqual({ podSelector: {}, policyTypes: ["Ingress"] })
      expect(result.metadata?.namespace).toBe("prod")
    }))
})

layer(NodeServices.layer)("NetworkPolicy.fromPodSet", (it) => {
  it.effect("lowers a podSet peer into podSelector.matchLabels", () =>
    Effect.gen(function*() {
      const apiPods = Selector.make({ app: "api" })
      const dbPods = Selector.make({ app: "db" })

      const np = NetworkPolicy.fromPodSet({
        name: "allow-db-from-api",
        namespace: "prod",
        podSet: dbPods,
        policyTypes: ["Ingress"],
        ingress: [{ from: [{ podSet: apiPods }], ports: [{ port: 5432 }] }]
      })

      const result = yield* np.render(ctx)
      expect(result.spec?.podSelector).toEqual({ matchLabels: { app: "db" } })
      expect(result.spec?.policyTypes).toEqual(["Ingress"])
      expect(result.spec?.ingress).toEqual([
        { from: [{ podSelector: { matchLabels: { app: "api" } } }], ports: [{ port: 5432 }] }
      ])
    }))

  it.effect("lowers a namespaceSelector peer without a podSelector key", () =>
    Effect.gen(function*() {
      const dbPods = Selector.make({ app: "db" })

      const np = NetworkPolicy.fromPodSet({
        name: "allow-from-ns",
        namespace: "prod",
        podSet: dbPods,
        ingress: [{ from: [{ namespaceSelector: { matchLabels: { team: "platform" } } }] }]
      })

      const result = yield* np.render(ctx)
      const rule = result.spec?.ingress?.[0]
      expect(rule?.from?.[0]).toEqual({ namespaceSelector: { matchLabels: { team: "platform" } } })
      expect(rule?.from?.[0]).not.toHaveProperty("podSelector")
    }))

  it.effect("lowers an ipBlock peer on the egress side", () =>
    Effect.gen(function*() {
      const dbPods = Selector.make({ app: "db" })

      const np = NetworkPolicy.fromPodSet({
        name: "restrict-egress",
        namespace: "prod",
        podSet: dbPods,
        policyTypes: ["Egress"],
        egress: [{ to: [{ ipBlock: { cidr: "10.0.0.0/8", except: ["10.0.1.0/24"] } }], ports: [{ port: 443 }] }]
      })

      const result = yield* np.render(ctx)
      expect(result.spec?.egress).toEqual([
        { to: [{ ipBlock: { cidr: "10.0.0.0/8", except: ["10.0.1.0/24"] } }], ports: [{ port: 443 }] }
      ])
    }))

  it.effect("a peer with all three fields lowers all three keys together", () =>
    Effect.gen(function*() {
      const dbPods = Selector.make({ app: "db" })
      const apiPods = Selector.make({ app: "api" })

      const np = NetworkPolicy.fromPodSet({
        name: "combo",
        namespace: "prod",
        podSet: dbPods,
        ingress: [{
          from: [{
            podSet: apiPods,
            namespaceSelector: { matchLabels: { team: "platform" } },
            ipBlock: { cidr: "10.0.0.0/8" }
          }]
        }]
      })

      const result = yield* np.render(ctx)
      expect(result.spec?.ingress?.[0]?.from?.[0]).toEqual({
        podSelector: { matchLabels: { app: "api" } },
        namespaceSelector: { matchLabels: { team: "platform" } },
        ipBlock: { cidr: "10.0.0.0/8" }
      })
    }))

  it.effect("omits ingress/egress from the spec when not provided", () =>
    Effect.gen(function*() {
      const dbPods = Selector.make({ app: "db" })
      const np = NetworkPolicy.fromPodSet({ name: "bare", namespace: "prod", podSet: dbPods })
      const result = yield* np.render(ctx)
      expect(result.spec?.ingress).toBeUndefined()
      expect(result.spec?.egress).toBeUndefined()
      expect(result.spec?.podSelector).toEqual({ matchLabels: { app: "db" } })
    }))
})
