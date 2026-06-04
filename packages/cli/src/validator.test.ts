import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { validateManifestFile } from "./validator";

describe("validateManifestFile", () => {
	it("accepts a valid single-document manifest", async () => {
		const content = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: prod
spec: {}
`;
		const issues = await Effect.runPromise(
			validateManifestFile({ file: "Deployment-api.yaml", content }),
		);
		expect(issues).toEqual([]);
	});

	it("flags a missing kind", async () => {
		const content = `apiVersion: apps/v1
metadata:
  name: api
`;
		const issues = await Effect.runPromise(
			validateManifestFile({ file: "x.yaml", content }),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toContain("envelope");
	});

	it("flags a misspelled metadata.name (uppercase)", async () => {
		const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: NotADnsLabel
`;
		const issues = await Effect.runPromise(
			validateManifestFile({ file: "x.yaml", content }),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toContain("envelope");
	});

	it("walks multi-doc YAML with per-doc indexing", async () => {
		const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
---
apiVersion: v1
kind: Service
metadata:
  name: SVC
`;
		const issues = await Effect.runPromise(
			validateManifestFile({ file: "multi.yaml", content }),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.doc).toBe(1);
	});

	it("accepts a manifest without namespace (cluster-scoped)", async () => {
		const content = `apiVersion: v1
kind: Namespace
metadata:
  name: app
`;
		const issues = await Effect.runPromise(
			validateManifestFile({ file: "ns.yaml", content }),
		);
		expect(issues).toEqual([]);
	});
});
