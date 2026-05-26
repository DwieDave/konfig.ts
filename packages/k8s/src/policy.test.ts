import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { PersistentVolume, PersistentVolumeClaim } from "./policy";
import { RenderContext } from "@konfig.ts/core";

describe("PersistentVolume strict spec", () => {
	const ctx = RenderContext.make("test");

	it("renders a valid PV with capacity + accessModes + hostPath", async () => {
		const pv = PersistentVolume.make({
			name: "data",
			spec: {
				capacity: { storage: "1Gi" },
				accessModes: ["ReadWriteOnce"],
				hostPath: { path: "/tmp/data", type: "DirectoryOrCreate" },
			},
		});
		const result = await Effect.runPromise(pv.render(ctx));
		expect(result.kind).toBe("PersistentVolume");
		expect(result.spec?.capacity?.storage).toBe("1Gi");
		expect(result.spec?.accessModes).toEqual(["ReadWriteOnce"]);
	});

	it("supports csi volume sources passed through from upstream type", async () => {
		const pv = PersistentVolume.make({
			name: "data",
			spec: {
				capacity: { storage: "10Gi" },
				accessModes: ["ReadWriteOnce"],
				csi: {
					driver: "csi.example.com",
					fsType: "ext4",
					volumeHandle: "vol-123",
				},
				storageClassName: "fast",
				persistentVolumeReclaimPolicy: "Retain",
				claimRef: { namespace: "prod", name: "data-pvc" },
			},
		});
		const result = await Effect.runPromise(pv.render(ctx));
		expect(result.spec?.csi?.driver).toBe("csi.example.com");
		expect(result.spec?.claimRef?.namespace).toBe("prod");
	});

	// Compile-time tests below assert the strict types reject invalid
	// specs. The constructions are commented out so the file compiles;
	// uncommenting any of them should produce a TS error.

	// @ts-expect-error — spec missing capacity
	void PersistentVolume.make({ name: "x", spec: { accessModes: ["ReadWriteOnce"] } });

	// @ts-expect-error — spec missing accessModes
	void PersistentVolume.make({ name: "x", spec: { capacity: { storage: "1Gi" } } });

	// @ts-expect-error — accessModes has invalid value
	void PersistentVolume.make({
		name: "x",
		spec: { capacity: { storage: "1Gi" }, accessModes: ["NotARealMode"] },
	});

	// @ts-expect-error — persistentVolumeReclaimPolicy has invalid value
	void PersistentVolume.make({
		name: "x",
		spec: {
			capacity: { storage: "1Gi" },
			accessModes: ["ReadWriteOnce"],
			persistentVolumeReclaimPolicy: "BogusValue",
		},
	});
});

describe("PersistentVolumeClaim strict spec", () => {
	const ctx = RenderContext.make("test");

	it("renders a valid PVC with accessModes + resources", async () => {
		const pvc = PersistentVolumeClaim.make({
			name: "data",
			namespace: "prod",
			spec: {
				accessModes: ["ReadWriteOnce"],
				resources: { requests: { storage: "5Gi" } },
				storageClassName: "fast",
			},
		});
		const result = await Effect.runPromise(pvc.render(ctx));
		expect(result.spec?.resources?.requests?.storage).toBe("5Gi");
	});

	// @ts-expect-error — spec missing accessModes
	void PersistentVolumeClaim.make({
		name: "x",
		namespace: "y",
		spec: { resources: { requests: { storage: "1Gi" } } },
	});

	// @ts-expect-error — spec missing resources
	void PersistentVolumeClaim.make({
		name: "x",
		namespace: "y",
		spec: { accessModes: ["ReadWriteOnce"] },
	});

	// @ts-expect-error — resources.requests missing storage
	void PersistentVolumeClaim.make({
		name: "x",
		namespace: "y",
		spec: { accessModes: ["ReadWriteOnce"], resources: { requests: {} } },
	});
});
