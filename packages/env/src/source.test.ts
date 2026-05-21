import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Redacted } from "effect";
import { describe, expect } from "vitest";
import { SecretSource, SecretSourceError } from "./source";

describe("SecretSource.fromConfig", () => {
	it.effect("resolves each key via Config.redacted", () =>
		Effect.gen(function* () {
			const src = SecretSource.fromConfig({ keys: ["url", "password"] as const });
			const v = yield* src.resolve;
			expect(Redacted.value(v.url)).toBe("postgres://localhost/api");
			expect(Redacted.value(v.password)).toBe("hunter2");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({
						url: "postgres://localhost/api",
						password: "hunter2",
					}),
				),
			),
		),
	);

	it.effect("envName mapping is applied", () =>
		Effect.gen(function* () {
			const src = SecretSource.fromConfig({
				keys: ["url", "password"] as const,
				envName: (k) => `DB_${k.toUpperCase()}`,
			});
			const v = yield* src.resolve;
			expect(Redacted.value(v.url)).toBe("u");
			expect(Redacted.value(v.password)).toBe("p");
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({ DB_URL: "u", DB_PASSWORD: "p" }),
				),
			),
		),
	);

	it.effect("missing key surfaces as SecretSourceError", () =>
		Effect.gen(function* () {
			const src = SecretSource.fromConfig({ keys: ["url"] as const });
			const r = yield* Effect.exit(src.resolve);
			expect(Exit.isFailure(r)).toBe(true);
			if (Exit.isFailure(r)) {
				const err = r.cause.toJSON();
				expect(JSON.stringify(err)).toContain("SecretSourceError");
			}
		}).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
	);

	it("exposes the key list verbatim", () => {
		const src = SecretSource.fromConfig({ keys: ["a", "b", "c"] as const });
		expect(src.keys).toEqual(["a", "b", "c"]);
	});
});

describe("SecretSource.literal", () => {
	it.effect("yields Redacted values from inline data", () =>
		Effect.gen(function* () {
			const src = SecretSource.literal({ data: { url: "u", password: "p" } });
			const v = yield* src.resolve;
			expect(Redacted.value(v.url)).toBe("u");
			expect(Redacted.value(v.password)).toBe("p");
		}),
	);

	it("derives keys from the data record", () => {
		const src = SecretSource.literal({ data: { url: "u", password: "p" } });
		expect([...src.keys].sort()).toEqual(["password", "url"]);
	});

	it("preserves literal key types (compile-time)", () => {
		const src = SecretSource.literal({ data: { url: "u" } });
		const k: "url" = src.keys[0] as "url";
		expect(k).toBe("url");
	});
});

describe("SecretSource error shape", () => {
	it("error carries source name + key + cause", () => {
		const err = new SecretSourceError({
			source: "fromConfig",
			key: "url",
			cause: "missing",
		});
		expect(err._tag).toBe("SecretSourceError");
		expect(err.source).toBe("fromConfig");
		expect(err.key).toBe("url");
		expect(err.cause).toBe("missing");
	});
});
