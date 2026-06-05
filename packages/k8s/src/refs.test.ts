import { describe, expect, it } from "vitest";
import { ConfigMapRef, SecretRef, ServiceAccountRef } from "./refs";

describe("branded refs (FR-4.4 — raw strings rejected at type level)", () => {
	it("constructors return the underlying string", () => {
		expect(SecretRef.of("api-creds")).toBe("api-creds");
		expect(ConfigMapRef.of("oauth-templates")).toBe("oauth-templates");
		expect(ServiceAccountRef.of("api")).toBe("api");
	});

	it("env-var (secretKeyRef) rejects raw string", async () => {
		const { secretEnv } = await import("./env");
		// @ts-expect-error — raw string for `ref` is not assignable to SecretRef.
		secretEnv({ name: "API_KEY", ref: "raw-string", key: "k" });
		const env = secretEnv({ name: "API_KEY", ref: SecretRef.of("api-creds"), key: "k" });
		expect(env.valueFrom?.secretKeyRef?.name).toBe("api-creds");
	});

	it("env-var with a keyed SecretRef rejects keys not in the declared union", async () => {
		const { secretEnv } = await import("./env");
		const ref = SecretRef.of<"db-creds", "url" | "password">("db-creds");
		// @ts-expect-error — "passowrd" is not in "url" | "password".
		secretEnv({ name: "DATABASE_PASSWORD", ref, key: "passowrd" });
		const env = secretEnv({ name: "DATABASE_PASSWORD", ref, key: "password" });
		expect(env.valueFrom?.secretKeyRef?.key).toBe("password");
	});

	it("secretEnvForPod accepts refs from the matching pod namespace", async () => {
		const { secretEnvForPod } = await import("./env");
		const { Secret } = await import("./identity");
		const dbCreds = Secret.make({
			name: "db-creds",
			namespace: "app",
			stringData: { url: "u" },
		});
		const env = secretEnvForPod({
			name: "DATABASE_URL",
			ref: dbCreds.ref,
			key: "url",
			podNamespace: "app",
		});
		expect(env.valueFrom?.secretKeyRef).toEqual({
			name: "db-creds",
			key: "url",
		});
	});

	it("secretEnvForPod rejects refs from a different namespace at compile time", async () => {
		const { secretEnvForPod } = await import("./env");
		const { Secret } = await import("./identity");
		const monCreds = Secret.make({
			name: "grafana",
			namespace: "monitoring",
			stringData: { token: "t" },
		});
		// @ts-expect-error — SecretRef<*, *, "monitoring"> not assignable to SecretRef<*, *, "app">.
		secretEnvForPod({
			name: "GRAFANA",
			ref: monCreds.ref,
			key: "token",
			podNamespace: "app",
		});

		// Escape hatch wires it through, runtime is unchanged.
		const escaped = SecretRef.unsafeReNamespace(monCreds.ref);
		const env = secretEnvForPod({
			name: "GRAFANA",
			ref: escaped,
			key: "token",
			podNamespace: "app",
		});
		expect(env.valueFrom?.secretKeyRef?.name).toBe("grafana");
	});

	it("env-var (configMapKeyRef) rejects raw string", async () => {
		const { configMapEnv } = await import("./env");
		// @ts-expect-error — raw string for `ref` is not assignable to ConfigMapRef.
		configMapEnv({ name: "CFG", ref: "raw-string", key: "k" });
		const env = configMapEnv({ name: "CFG", ref: ConfigMapRef.of("cfg"), key: "k" });
		expect(env.valueFrom?.configMapKeyRef?.name).toBe("cfg");
	});

	it("env-var with a keyed ConfigMapRef rejects keys not in the declared union", async () => {
		const { configMapEnv } = await import("./env");
		const ref = ConfigMapRef.of<"app-config", "HOST" | "PORT">("app-config");
		// @ts-expect-error — "PROT" is not in "HOST" | "PORT".
		configMapEnv({ name: "DB_PORT", ref, key: "PROT" });
		const env = configMapEnv({ name: "DB_PORT", ref, key: "PORT" });
		expect(env.valueFrom?.configMapKeyRef?.key).toBe("PORT");
	});

	it("volume from Secret rejects raw string", async () => {
		const { volumeFromSecret } = await import("./volume");
		// @ts-expect-error — raw string for `ref` is not assignable to SecretRef.
		volumeFromSecret({ name: "v", ref: "raw-string" });
		const v = volumeFromSecret({ name: "v", ref: SecretRef.of("creds") });
		expect(v.secret?.secretName).toBe("creds");
	});

	it("volume from ConfigMap rejects raw string", async () => {
		const { volumeFromConfigMap } = await import("./volume");
		// @ts-expect-error — raw string for `ref` is not assignable to ConfigMapRef.
		volumeFromConfigMap({ name: "v", ref: "raw-string" });
		const v = volumeFromConfigMap({ name: "v", ref: ConfigMapRef.of("cfg") });
		expect(v.configMap?.name).toBe("cfg");
	});

	it("imagePullSecret rejects raw string", async () => {
		const { imagePullSecret } = await import("./container");
		// @ts-expect-error — raw string is not assignable to SecretRef.
		imagePullSecret("raw-string");
		const ips = imagePullSecret(SecretRef.of("ghcr-pull"));
		expect(ips.name).toBe("ghcr-pull");
	});

	it("Ingress TLS rejects raw string", async () => {
		const { ingressTLS } = await import("./network");
		// @ts-expect-error — raw string is not assignable to SecretRef.
		ingressTLS({ secretName: "raw-string" });
		const tls = ingressTLS({ secretName: SecretRef.of("tls") });
		expect(tls.secretName).toBe("tls");
	});
});
