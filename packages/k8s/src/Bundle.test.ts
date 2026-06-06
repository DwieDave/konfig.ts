import { describe, expect, it } from "vitest";
import * as Bundle from "./Bundle";

describe("Bundle.make", () => {
	it("constructs a Bundle with the given fields", () => {
		const b = Bundle.make({
			name: "api",
			namespace: "app",
			manifests: [{ kind: "ConfigMap", metadata: { name: "api-conf" } }],
		});
		expect(b.name).toBe("api");
		expect(b.namespace).toBe("app");
		expect(b.manifests).toHaveLength(1);
	});

	it("omits namespace when not provided", () => {
		const b = Bundle.make({ name: "cluster-scoped", manifests: [] });
		expect(b.namespace).toBeUndefined();
	});
});
