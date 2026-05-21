import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect } from "vitest";
import { EnvNameCollision } from "./entry";
import { defineDownward } from "./downward";
import { defineEnvironment } from "./environment";
import { defineLiteral } from "./literal";
import { defineSecret } from "./secret";

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

describe("defineEnvironment", () => {
	it("bundles entries and re-exposes them via .members", () => {
		const env = defineEnvironment({ db: dbCreds, session: sessionKey, port, pod: podName });
		expect(env._kind).toBe("Environment");
		expect(env.members.db).toBe(dbCreds);
		expect(env.members.session).toBe(sessionKey);
		expect(env.members.port).toBe(port);
		expect(env.members.pod).toBe(podName);
	});

	it("flattens all member envClaims", () => {
		const env = defineEnvironment({ db: dbCreds, port });
		const names = env.envClaims.map((c) => c.envName).sort();
		expect(names).toEqual(["DATABASE_PASSWORD", "DATABASE_URL", "PORT"]);
	});

	it.effect("yields a record of all member values in one go", () =>
		Effect.gen(function* () {
			const env = defineEnvironment({
				db: dbCreds,
				session: sessionKey,
				port,
				pod: podName,
			});
			const v = yield* env;
			expect(Redacted.value(v.db.url)).toBe("postgres://localhost/api");
			expect(Redacted.value(v.db.password)).toBe("hunter2");
			expect(Redacted.value(v.session.value)).toBe("sig");
			expect(v.port).toBe(8080);
			expect(v.pod).toBe("api-7c9d8");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: {
							DATABASE_URL: "postgres://localhost/api",
							DATABASE_PASSWORD: "hunter2",
							SESSION_KEY: "sig",
							POD_NAME: "api-7c9d8",
						},
					}),
				),
			),
		),
	);

	it("throws EnvNameCollision when two entries claim the same env name", () => {
		const a = defineSecret({
			name: "a",
			namespace: "x",
			env: { url: "SHARED" },
		});
		const b = defineLiteral({ envName: "SHARED", value: "literal" });
		expect(() => defineEnvironment({ a, b })).toThrow(EnvNameCollision);
	});

	it("collision error names the conflicting entries", () => {
		const a = defineSecret({ name: "a", namespace: "x", env: { url: "SHARED" } });
		const b = defineSecret({ name: "b", namespace: "x", env: { val: "SHARED" } });
		try {
			defineEnvironment({ a, b });
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(EnvNameCollision);
			const err = e as EnvNameCollision;
			expect(err.envName).toBe("SHARED");
			expect(err.claims).toEqual(["Secret(a).url", "Secret(b).val"]);
			expect(err.message).toContain("SHARED");
			expect(err.message).toContain("Secret(a).url");
		}
	});

	it("a SecretEntry may live in multiple bundles (no copy)", () => {
		const envA = defineEnvironment({ db: dbCreds });
		const envB = defineEnvironment({ db: dbCreds });
		expect(envA.members.db).toBe(envB.members.db);
	});
});
