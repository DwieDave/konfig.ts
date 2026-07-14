import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { RenderContext } from "@konfig.ts/core"
import { Effect } from "effect"
import { PersistentVolume, PersistentVolumeClaim } from "./policy"

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

  // Compile-time tests below assert the strict types reject invalid
  // specs. The constructions are commented out so the file compiles;
  // uncommenting any of them should produce a TS error.

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
