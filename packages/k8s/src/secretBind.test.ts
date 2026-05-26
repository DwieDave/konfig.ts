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

	it("namespace override at bind time wins over the contract's declared namespace", () => {
		const bound = Environment.bind({ env: apiEnv, namespace: "staging" });
		expect(bound.members.db.namespace).toBe("staging");
		expect(bound.members.session.namespace).toBe("staging");
		// envVars are namespace-independent — they only carry the Secret name + key.
		expect(bound.envVars.map((e) => e.name).sort()).toEqual([
			"DATABASE_PASSWORD",
			"DATABASE_URL",
			"POD_NAME",
			"PORT",
			"SESSION_KEY",
		]);
	});
});

describe("Secret.bind namespace override", () => {
	it("overrides the contract namespace for the manifest binding", () => {
		const bound = Secret.bind({ secret: dbCreds, namespace: "staging" });
		expect(bound.namespace).toBe("staging");
		// envVars carry the secret name + key only — namespace is invisible.
		expect(bound.envVars).toHaveLength(2);
	});

	it("falls back to the contract namespace when no override is given", () => {
		const bound = Secret.bind({ secret: dbCreds });
		expect(bound.namespace).toBe("prod");
	});
});

describe("Environment.bind literal value overrides", () => {
	const clientUrl = defineLiteral({ envName: "CLIENT_URL", value: "" });
	const replicas = defineLiteral({ envName: "REPLICAS", value: 0 });
	const env = defineEnvironment({ db: dbCreds, clientUrl, replicas });

	it("a missing override falls back to the declared value", () => {
		const bound = Environment.bind({ env });
		const byName = new Map(bound.envVars.map((e) => [e.name, e]));
		expect(byName.get("CLIENT_URL")?.value).toBe("");
		expect(byName.get("REPLICAS")?.value).toBe("0");
	});

	it("a provided override replaces the manifest's emitted env var", () => {
		const bound = Environment.bind({
			env,
			literals: { clientUrl: "https://api.example.com", replicas: 3 },
		});
		const byName = new Map(bound.envVars.map((e) => [e.name, e]));
		expect(byName.get("CLIENT_URL")?.value).toBe("https://api.example.com");
		expect(byName.get("REPLICAS")?.value).toBe("3");
	});

	it("the override updates the declared member's value field too", () => {
		const bound = Environment.bind({ env, literals: { replicas: 3 } });
		expect(bound.members.replicas.value).toBe(3);
		expect(bound.members.clientUrl.value).toBe("");
	});

	it("partial overrides only touch the named members", () => {
		const bound = Environment.bind({ env, literals: { clientUrl: "https://x" } });
		const byName = new Map(bound.envVars.map((e) => [e.name, e]));
		expect(byName.get("CLIENT_URL")?.value).toBe("https://x");
		expect(byName.get("REPLICAS")?.value).toBe("0");
	});

	it("custom serialize fn is reused for overrides", () => {
		const lit = defineLiteral({
			envName: "LIST",
			value: ["a"] as ReadonlyArray<string>,
			serialize: (xs: ReadonlyArray<string>) => xs.join(","),
		});
		const e = defineEnvironment({ lit });
		const bound = Environment.bind({ env: e, literals: { lit: ["a", "b", "c"] } });
		const entry = bound.envVars.find((v) => v.name === "LIST");
		expect(entry?.value).toBe("a,b,c");
	});
});
