import { defineDownward, defineEnvironment, defineLiteral, defineSecret } from "@konfig.ts/env";
import { describe, expect, it } from "vitest";
import { Environment, Secret } from "./index";

const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const sessionKey = defineSecret({
	name: "session-key",
	namespace: "prod",
	env: { value: "SESSION_KEY" },
});

const port = defineLiteral({ envName: "PORT", value: 8080 });
const podName = defineDownward({ envName: "POD_NAME", fieldPath: "metadata.name" });

describe("Secret.bind", () => {
	it("produces a typed ref and envVars per key", () => {
		const bound = Secret.bind({ secret: dbCreds });
		expect(bound.ref).toBe("db-creds");
		expect(bound.name).toBe("db-creds");
		expect(bound.namespace).toBe("prod");
		expect(bound.envVars).toHaveLength(2);

		const byName = new Map(bound.envVars.map((e) => [e.name, e]));
		expect(byName.get("DATABASE_URL")?.valueFrom?.secretKeyRef).toEqual({
			name: "db-creds",
			key: "url",
		});
		expect(byName.get("DATABASE_PASSWORD")?.valueFrom?.secretKeyRef).toEqual({
			name: "db-creds",
			key: "password",
		});
	});
});

describe("Environment.bind", () => {
	const apiEnv = defineEnvironment({
		db: dbCreds,
		session: sessionKey,
		port,
		pod: podName,
	});

	it("walks every member and concatenates envVars", () => {
		const bound = Environment.bind({ env: apiEnv });
		const names = bound.envVars.map((e) => e.name).sort();
		expect(names).toEqual(["DATABASE_PASSWORD", "DATABASE_URL", "POD_NAME", "PORT", "SESSION_KEY"]);
	});

	it("literal members produce { name, value }", () => {
		const bound = Environment.bind({ env: apiEnv });
		const portEntry = bound.envVars.find((e) => e.name === "PORT");
		expect(portEntry?.value).toBe("8080");
		expect(portEntry?.valueFrom).toBeUndefined();
	});

	it("downward members produce a fieldRef envVar", () => {
		const bound = Environment.bind({ env: apiEnv });
		const pod = bound.envVars.find((e) => e.name === "POD_NAME");
		expect(pod?.valueFrom?.fieldRef?.fieldPath).toBe("metadata.name");
	});

	it("exposes declared per-member handles via .members", () => {
		const bound = Environment.bind({ env: apiEnv });
		expect(bound.members.db.ref).toBe("db-creds");
		expect(bound.members.session.ref).toBe("session-key");
		expect(bound.members.port.value).toBe(8080);
		expect(bound.members.pod.fieldPath).toBe("metadata.name");
	});

	it("works with a single-member bundle", () => {
		const env = defineEnvironment({ db: dbCreds });
		const bound = Environment.bind({ env });
		expect(bound.envVars).toHaveLength(2);
		expect(bound.members.db.ref).toBe("db-creds");
	});
});
