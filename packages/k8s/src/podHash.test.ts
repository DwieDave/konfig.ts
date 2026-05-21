import { it } from "@effect/vitest";
import { defineEnvironment, defineSecret, SecretSource } from "@konfig.ts/env";
import { NodeServices } from "@effect/platform-node";
import { Effect, Redacted } from "effect";
import { describe, expect, it as vitestIt } from "vitest";
import { Environment, hashSecretValues, Secret } from "./index";

const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

describe("hashSecretValues", () => {
	vitestIt("deterministic over the same input", () => {
		const a = hashSecretValues({
			values: { url: Redacted.make("u"), password: Redacted.make("p") },
		});
		const b = hashSecretValues({
			values: { url: Redacted.make("u"), password: Redacted.make("p") },
		});
		expect(a).toBe(b);
	});

	vitestIt("sorted-by-key — insertion order doesn't matter", () => {
		const a = hashSecretValues({
			values: { url: Redacted.make("u"), password: Redacted.make("p") },
		});
		const b = hashSecretValues({
			values: { password: Redacted.make("p"), url: Redacted.make("u") },
		});
		expect(a).toBe(b);
	});

	vitestIt("changing any value changes the hash", () => {
		const a = hashSecretValues({ values: { x: Redacted.make("1") } });
		const b = hashSecretValues({ values: { x: Redacted.make("2") } });
		expect(a).not.toBe(b);
	});

	vitestIt("output is hex of requested length (default 16)", () => {
		const h = hashSecretValues({ values: { x: Redacted.make("v") } });
		expect(h).toMatch(/^[0-9a-f]{16}$/);
		const long = hashSecretValues({ values: { x: Redacted.make("v") }, length: 32 });
		expect(long).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe("Secret.bind values service", () => {
	vitestIt("source supplied → .values and .layer defined", () => {
		const b = Secret.bind({
			secret: dbCreds,
			source: SecretSource.literal({ data: { url: "u", password: "p" } }),
		});
		expect(b.values).toBeDefined();
		expect(b.layer).toBeDefined();
	});

	vitestIt("no source → .values and .layer undefined", () => {
		const b = Secret.bind({ secret: dbCreds });
		expect(b.values).toBeUndefined();
		expect(b.layer).toBeUndefined();
	});

	it.effect("yielding .values inside an Effect resolves to typed Redacted record", () =>
		Effect.gen(function* () {
			const b = Secret.bind({
				secret: dbCreds,
				source: SecretSource.literal({
					data: { url: "postgres://x", password: "hunter2" },
				}),
			});
			const v = yield* b.values!;
			expect(Redacted.value(v.url)).toBe("postgres://x");
			expect(Redacted.value(v.password)).toBe("hunter2");
			const hash = hashSecretValues({ values: v });
			expect(hash).toMatch(/^[0-9a-f]{16}$/);
		}).pipe(
			Effect.provide(
				Secret.bind({
					secret: dbCreds,
					source: SecretSource.literal({
						data: { url: "postgres://x", password: "hunter2" },
					}),
				}).layer!,
			),
			Effect.provide(NodeServices.layer),
		),
	);
});

describe("Environment.bind valuesLayer", () => {
	const sessionKey = defineSecret({
		name: "session-key",
		namespace: "prod",
		env: { value: "SESSION_KEY" },
	});

	const apiEnv = defineEnvironment({ db: dbCreds, session: sessionKey });

	it.effect("aggregates per-member values layers; yields both via tags", () =>
		Effect.gen(function* () {
			const bound = Environment.bind({
				env: apiEnv,
				secrets: {
					db: {
						source: SecretSource.literal({ data: { url: "u", password: "p" } }),
					},
					session: {
						source: SecretSource.literal({ data: { value: "sig" } }),
					},
				},
			});
			const dbV = yield* bound.members.db.values!;
			const sV = yield* bound.members.session.values!;
			expect(Redacted.value(dbV.url)).toBe("u");
			expect(Redacted.value(sV.value)).toBe("sig");
		}).pipe(
			Effect.provide(
				Environment.bind({
					env: apiEnv,
					secrets: {
						db: {
							source: SecretSource.literal({ data: { url: "u", password: "p" } }),
						},
						session: {
							source: SecretSource.literal({ data: { value: "sig" } }),
						},
					},
				}).valuesLayer,
			),
			Effect.provide(NodeServices.layer),
		),
	);
});
