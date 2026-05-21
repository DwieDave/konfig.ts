import { it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect } from "vitest";
import { defineSecret } from "./secret";

describe("defineSecret", () => {
	const dbCreds = defineSecret({
		name: "db-creds",
		namespace: "prod",
		env: {
			url: "DATABASE_URL",
			password: "DATABASE_PASSWORD",
		},
	});

	it("carries metadata", () => {
		expect(dbCreds._kind).toBe("Secret");
		expect(dbCreds.name).toBe("db-creds");
		expect(dbCreds.namespace).toBe("prod");
		expect(dbCreds.env.url).toBe("DATABASE_URL");
		expect(dbCreds.env.password).toBe("DATABASE_PASSWORD");
		expect(dbCreds.keys).toEqual(["url", "password"]);
	});

	it("declares one envClaim per key", () => {
		expect(dbCreds.envClaims.map((c) => c.envName).sort()).toEqual([
			"DATABASE_PASSWORD",
			"DATABASE_URL",
		]);
	});

	it.effect("yields a typed Redacted record from the injected env", () =>
		Effect.gen(function* () {
			const v = yield* dbCreds;
			expect(Redacted.value(v.url)).toBe("postgres://localhost/api");
			expect(Redacted.value(v.password)).toBe("hunter2");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: {
							DATABASE_URL: "postgres://localhost/api",
							DATABASE_PASSWORD: "hunter2",
						},
					}),
				),
			),
		),
	);

	it.effect("exposes per-key sub-Configs via .fields", () =>
		Effect.gen(function* () {
			const url = yield* dbCreds.fields.url;
			expect(Redacted.value(url)).toBe("postgres://localhost/api");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: {
							DATABASE_URL: "postgres://localhost/api",
							DATABASE_PASSWORD: "hunter2",
						},
					}),
				),
			),
		),
	);

	it.effect("missing env var surfaces as ConfigError", () =>
		Effect.gen(function* () {
			const r = yield* Effect.exit(dbCreds.asEffect());
			expect(r._tag).toBe("Failure");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
			),
		),
	);

	it("redacted values do not leak in toString / JSON", () =>
		Effect.runSync(
			Effect.gen(function* () {
				const v = yield* dbCreds;
				expect(String(v.url)).not.toContain("postgres://localhost/api");
				expect(JSON.stringify(v)).not.toContain("hunter2");
			}).pipe(
				Effect.provide(
					ConfigProvider.layer(
						ConfigProvider.fromEnv({
							env: {
								DATABASE_URL: "postgres://localhost/api",
								DATABASE_PASSWORD: "hunter2",
							},
						}),
					),
				),
			),
		),
	);

	it("preserves literal types of env keys (compile-time)", () => {
		// Type-only assertion: dbCreds.env.url should be the literal "DATABASE_URL".
		const url: "DATABASE_URL" = dbCreds.env.url;
		const pw: "DATABASE_PASSWORD" = dbCreds.env.password;
		expect(url).toBe("DATABASE_URL");
		expect(pw).toBe("DATABASE_PASSWORD");
	});

	it("composes with Config combinators", () => {
		const opt = Config.option(dbCreds);
		expect(typeof opt).toBe("object");
	});
});
