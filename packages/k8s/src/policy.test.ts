import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { RenderContext } from "@konfig.ts/core"
import { Effect } from "effect"
import {
  ClusterRole,
  ClusterRoleBinding,
  NetworkPolicy,
  PersistentVolume,
  PersistentVolumeClaim,
  Role,
  RoleBinding
} from "./policy"
import { Selector } from "./selector"

const ctx = RenderContext.make("test")

layer(NodeServices.layer)("PersistentVolume strict spec", (it) => {
  it.effect("renders a valid PV with capacity + accessModes + hostPath", () =>
    Effect.gen(function*() {
      const pv = PersistentVolume.make({
        name: "data",
        spec: {
          capacity: { storage: "1Gi" },
          accessModes: ["ReadWriteOnce"],
          hostPath: { path: "/tmp/data", type: "DirectoryOrCreate" }
        }
      })
      const result = yield* pv.render(ctx)
      expect(result.kind).toBe("PersistentVolume")
      expect(result.spec?.capacity?.storage).toBe("1Gi")
      expect(result.spec?.accessModes).toEqual(["ReadWriteOnce"])
    }))

  it.effect("supports csi volume sources passed through from upstream type", () =>
    Effect.gen(function*() {
      const pv = PersistentVolume.make({
        name: "data",
        spec: {
          capacity: { storage: "10Gi" },
          accessModes: ["ReadWriteOnce"],
          csi: {
            driver: "csi.example.com",
            fsType: "ext4",
            volumeHandle: "vol-123"
          },
          storageClassName: "fast",
          persistentVolumeReclaimPolicy: "Retain",
          claimRef: { namespace: "prod", name: "data-pvc" }
        }
      })
      const result = yield* pv.render(ctx)
      expect(result.spec?.csi?.driver).toBe("csi.example.com")
      expect(result.spec?.claimRef?.namespace).toBe("prod")
    }))

  // @ts-expect-error — spec missing capacity
  void PersistentVolume.make({ name: "x", spec: { accessModes: ["ReadWriteOnce"] } })

  // @ts-expect-error — spec missing accessModes
  void PersistentVolume.make({ name: "x", spec: { capacity: { storage: "1Gi" } } })

  void PersistentVolume.make({
    name: "x",
    // @ts-expect-error — accessModes has invalid value
    spec: { capacity: { storage: "1Gi" }, accessModes: ["NotARealMode"] }
  })

  void PersistentVolume.make({
    name: "x",
    spec: {
      capacity: { storage: "1Gi" },
      accessModes: ["ReadWriteOnce"],
      // @ts-expect-error — persistentVolumeReclaimPolicy has invalid value
      persistentVolumeReclaimPolicy: "BogusValue"
    }
  })
})

layer(NodeServices.layer)("PersistentVolumeClaim strict spec", (it) => {
  it.effect("renders a valid PVC with accessModes + resources", () =>
    Effect.gen(function*() {
      const pvc = PersistentVolumeClaim.make({
        name: "data",
        namespace: "prod",
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "5Gi" } },
          storageClassName: "fast"
        }
      })
      const result = yield* pvc.render(ctx)
      expect(result.spec?.resources?.requests?.storage).toBe("5Gi")
    }))

  void PersistentVolumeClaim.make({
    name: "x",
    namespace: "y",
    // @ts-expect-error — spec missing accessModes
    spec: { resources: { requests: { storage: "1Gi" } } }
  })

  void PersistentVolumeClaim.make({
    name: "x",
    namespace: "y",
    // @ts-expect-error — spec missing resources
    spec: { accessModes: ["ReadWriteOnce"] }
  })

  void PersistentVolumeClaim.make({
    name: "x",
    namespace: "y",
    // @ts-expect-error — resources.requests missing storage
    spec: { accessModes: ["ReadWriteOnce"], resources: { requests: {} } }
  })
})

layer(NodeServices.layer)("NetworkPolicy.make", (it) => {
  it.effect("passes the raw spec through unchanged", () =>
    Effect.gen(function*() {
      const np = NetworkPolicy.make({
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

layer(NodeServices.layer)("RBAC resources", (it) => {
  it.effect("ClusterRole.make renders rules and aggregationRule", () =>
    Effect.gen(function*() {
      const cr = ClusterRole.make({
        name: "reader",
        rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
        aggregationRule: { clusterRoleSelectors: [{ matchLabels: { "rbac.example.com/aggregate": "true" } }] }
      })
      const result = yield* cr.render(ctx)
      expect(result.kind).toBe("ClusterRole")
      expect(result.apiVersion).toBe("rbac.authorization.k8s.io/v1")
      expect(result.metadata?.name).toBe("reader")
      expect(result.rules).toEqual([{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }])
      expect(result.aggregationRule).toEqual({
        clusterRoleSelectors: [{ matchLabels: { "rbac.example.com/aggregate": "true" } }]
      })
    }))

  it.effect("ClusterRoleBinding.make renders roleRef and subjects", () =>
    Effect.gen(function*() {
      const crb = ClusterRoleBinding.make({
        name: "reader-binding",
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "reader" },
        subjects: [{ kind: "ServiceAccount", name: "api", namespace: "prod" }]
      })
      const result = yield* crb.render(ctx)
      expect(result.kind).toBe("ClusterRoleBinding")
      expect(result.roleRef).toEqual({ apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "reader" })
      expect(result.subjects).toEqual([{ kind: "ServiceAccount", name: "api", namespace: "prod" }])
    }))

  it.effect("Role.make renders namespaced rules", () =>
    Effect.gen(function*() {
      const role = Role.make({
        name: "pod-reader",
        namespace: "prod",
        rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get"] }]
      })
      const result = yield* role.render(ctx)
      expect(result.kind).toBe("Role")
      expect(result.metadata?.namespace).toBe("prod")
      expect(result.rules).toEqual([{ apiGroups: [""], resources: ["pods"], verbs: ["get"] }])
    }))

  it.effect("RoleBinding.make renders roleRef and subjects within a namespace", () =>
    Effect.gen(function*() {
      const rb = RoleBinding.make({
        name: "pod-reader-binding",
        namespace: "prod",
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "pod-reader" },
        subjects: [{ kind: "ServiceAccount", name: "api", namespace: "prod" }]
      })
      const result = yield* rb.render(ctx)
      expect(result.kind).toBe("RoleBinding")
      expect(result.metadata?.namespace).toBe("prod")
      expect(result.roleRef).toEqual({ apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "pod-reader" })
      expect(result.subjects).toEqual([{ kind: "ServiceAccount", name: "api", namespace: "prod" }])
    }))
})
