import { describe, expect, it } from "vitest";
import { serialize } from "./serialize";

describe("serialize — k8s kind snapshots", () => {
	it("Deployment", () => {
		expect(
			serialize({
				value: {
					apiVersion: "apps/v1",
					kind: "Deployment",
					metadata: { name: "api", namespace: "prod" },
					spec: {
						replicas: 2,
						selector: { matchLabels: { app: "api" } },
						template: {
							metadata: { labels: { app: "api" } },
							spec: {
								containers: [
									{
										name: "api",
										image: "ghcr.io/example/api:1.0.0",
									},
								],
							},
						},
					},
				},
			}),
		).toMatchSnapshot();
	});

	it("StatefulSet", () => {
		expect(
			serialize({
				value: {
					apiVersion: "apps/v1",
					kind: "StatefulSet",
					metadata: { name: "db", namespace: "prod" },
					spec: {
						serviceName: "db",
						replicas: 3,
						selector: { matchLabels: { app: "db" } },
						template: {
							metadata: { labels: { app: "db" } },
							spec: { containers: [{ name: "db", image: "postgres:16" }] },
						},
					},
				},
			}),
		).toMatchSnapshot();
	});

	it("Service", () => {
		expect(
			serialize({
				value: {
					apiVersion: "v1",
					kind: "Service",
					metadata: { name: "api", namespace: "prod" },
					spec: { selector: { app: "api" }, ports: [{ port: 80, targetPort: 8080 }] },
				},
			}),
		).toMatchSnapshot();
	});

	it("ConfigMap", () => {
		expect(
			serialize({
				value: {
					apiVersion: "v1",
					kind: "ConfigMap",
					metadata: { name: "cfg", namespace: "prod" },
					data: { LOG_LEVEL: "info", HTTP_PORT: "8080" },
				},
			}),
		).toMatchSnapshot();
	});

	it("Secret", () => {
		expect(
			serialize({
				value: {
					apiVersion: "v1",
					kind: "Secret",
					metadata: { name: "api-creds", namespace: "prod" },
					type: "Opaque",
					stringData: { url: "postgres://..." },
				},
			}),
		).toMatchSnapshot();
	});

	it("ServiceAccount", () => {
		expect(
			serialize({
				value: {
					apiVersion: "v1",
					kind: "ServiceAccount",
					metadata: { name: "api", namespace: "prod" },
				},
			}),
		).toMatchSnapshot();
	});

	it("Role", () => {
		expect(
			serialize({
				value: {
					apiVersion: "rbac.authorization.k8s.io/v1",
					kind: "Role",
					metadata: { name: "reader", namespace: "prod" },
					rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
				},
			}),
		).toMatchSnapshot();
	});

	it("RoleBinding", () => {
		expect(
			serialize({
				value: {
					apiVersion: "rbac.authorization.k8s.io/v1",
					kind: "RoleBinding",
					metadata: { name: "reader", namespace: "prod" },
					subjects: [{ kind: "ServiceAccount", name: "api" }],
					roleRef: { kind: "Role", name: "reader", apiGroup: "rbac.authorization.k8s.io" },
				},
			}),
		).toMatchSnapshot();
	});

	it("Ingress", () => {
		expect(
			serialize({
				value: {
					apiVersion: "networking.k8s.io/v1",
					kind: "Ingress",
					metadata: { name: "api", namespace: "prod" },
					spec: {
						ingressClassName: "nginx",
						tls: [{ hosts: ["api.example.com"], secretName: "api-tls" }],
						rules: [
							{
								host: "api.example.com",
								http: {
									paths: [
										{
											path: "/",
											pathType: "Prefix",
											backend: { service: { name: "api", port: { number: 80 } } },
										},
									],
								},
							},
						],
					},
				},
			}),
		).toMatchSnapshot();
	});

	it("NetworkPolicy", () => {
		expect(
			serialize({
				value: {
					apiVersion: "networking.k8s.io/v1",
					kind: "NetworkPolicy",
					metadata: { name: "api", namespace: "prod" },
					spec: { podSelector: { matchLabels: { app: "api" } }, policyTypes: ["Ingress"] },
				},
			}),
		).toMatchSnapshot();
	});

	it("PersistentVolumeClaim", () => {
		expect(
			serialize({
				value: {
					apiVersion: "v1",
					kind: "PersistentVolumeClaim",
					metadata: { name: "data", namespace: "prod" },
					spec: {
						accessModes: ["ReadWriteOnce"],
						resources: { requests: { storage: "10Gi" } },
					},
				},
			}),
		).toMatchSnapshot();
	});

	it("CronJob", () => {
		expect(
			serialize({
				value: {
					apiVersion: "batch/v1",
					kind: "CronJob",
					metadata: { name: "nightly", namespace: "prod" },
					spec: {
						schedule: "0 2 * * *",
						jobTemplate: {
							spec: {
								template: {
									spec: {
										containers: [{ name: "tick", image: "ghcr.io/example/worker:1.0.0" }],
										restartPolicy: "OnFailure",
									},
								},
							},
						},
					},
				},
			}),
		).toMatchSnapshot();
	});

	it("Job", () => {
		expect(
			serialize({
				value: {
					apiVersion: "batch/v1",
					kind: "Job",
					metadata: { name: "migrate", namespace: "prod" },
					spec: {
						template: {
							spec: {
								containers: [{ name: "migrate", image: "migrate:1" }],
								restartPolicy: "Never",
							},
						},
					},
				},
			}),
		).toMatchSnapshot();
	});

	it("special numeric values stay as strings when supplied as strings", () => {
		expect(
			serialize({
				value: {
					apiVersion: "v1",
					kind: "ConfigMap",
					metadata: { name: "cfg" },
					data: {
						ZERO_STR: "0",
						FLOAT_STR: "1.0",
						BOOL_STR: "false",
						YES_STR: "yes",
					},
				},
			}),
		).toMatchSnapshot();
	});

	it("escapes special characters", () => {
		expect(
			serialize({
				value: {
					apiVersion: "v1",
					kind: "ConfigMap",
					metadata: { name: "cfg" },
					data: {
						QUOTE: 'contains a "double quote"',
						COLON: "value: with colon",
						MULTILINE: "line one\nline two",
					},
				},
			}),
		).toMatchSnapshot();
	});
});
