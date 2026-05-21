import { it } from "@effect/vitest";
import { coerce, Yaml } from "@konfig.ts/core";
import { defineSecret, SecretSource } from "@konfig.ts/env";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Logger } from "effect";
import { describe, expect, it as vitestIt } from "vitest";
import type { Secret as K8sSecret } from "./.generated/k8s-types";
import { BackendSourceMissing } from "./backend";
import { NativeSecret } from "./nativeSecret";
import { bindSecret } from "./secretBind";

const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const ctx = { env: "prod" } as const;

const _captureLogger = (sink: string[]) =>
	Logger.make(({ message }) => {
		if (Array.isArray(message)) {
			for (const m of message) sink.push(String(m));
		} else {
			sink.push(String(message));
		}
	});

describe("NativeSecret.backend", () => {
	it.effect("renders a kind: Secret with stringData from a literal source", () =>
		Effect.gen(function* () {
			const bound = bindSecret({
				secret: dbCreds,
				backend: NativeSecret.backend({ silenceWarning: true }),
				source: SecretSource.literal({
					data: { url: "postgres://localhost/api", password: "hunter2" },
				}),
			});
			const rendered = yield* bound.manifest!.render(ctx);
			const res = coerce<K8sSecret>(rendered);
			expect(res.apiVersion).toBe("v1");
			expect(res.kind).toBe("Secret");
			expect(res.metadata?.name).toBe("db-creds");
			expect(res.metadata?.namespace).toBe("prod");
			expect(res.stringData).toEqual({
				url: "postgres://localhost/api",
				password: "hunter2",
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("YAML output contains stringData (warning silenced)", () =>
		Effect.gen(function* () {
			const bound = bindSecret({
				secret: dbCreds,
				backend: NativeSecret.backend({ silenceWarning: true }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const rendered = yield* bound.manifest!.render(ctx);
			const yaml = Yaml.serialize({ value: rendered });
			expect(yaml).toContain("kind: Secret");
			expect(yaml).toContain("url: u");
			expect(yaml).toContain("password: p");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	vitestIt("throws BackendSourceMissing when source is omitted", () => {
		expect(() =>
			bindSecret({
				secret: dbCreds,
				backend: NativeSecret.backend({ silenceWarning: true }),
			}),
		).toThrow(BackendSourceMissing);
	});

	it.effect("emits a render-time warning by default", () =>
		Effect.gen(function* () {
			const messages: string[] = [];
			const bound = bindSecret({
				secret: dbCreds,
				backend: NativeSecret.backend(),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			yield* bound.manifest!.render(ctx).pipe(Effect.withLogger(_captureLogger(messages)));
			expect(messages.some((m) => m.includes("plaintext Secret"))).toBe(true);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("silenceWarning: true suppresses the warning", () =>
		Effect.gen(function* () {
			const messages: string[] = [];
			const bound = bindSecret({
				secret: dbCreds,
				backend: NativeSecret.backend({ silenceWarning: true }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			yield* bound.manifest!.render(ctx).pipe(Effect.withLogger(_captureLogger(messages)));
			expect(messages.some((m) => m.includes("plaintext"))).toBe(false);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("source failure surfaces as RenderError", () =>
		Effect.gen(function* () {
			const bound = bindSecret({
				secret: defineSecret({
					name: "missing",
					namespace: "prod",
					env: { x: "MISSING_ENV_NEVER_SET" },
				}),
				backend: NativeSecret.backend({ silenceWarning: true }),
				source: SecretSource.fromConfig({ keys: ["x"] as const }),
			});
			const exit = yield* Effect.exit(bound.manifest!.render(ctx));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).toContain("RenderError");
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("Secret.bind refLayer", () => {
	vitestIt("always exposes a refLayer regardless of backend", () => {
		const a = bindSecret({ secret: dbCreds });
		expect(a.refLayer).toBeDefined();
		const b = bindSecret({
			secret: dbCreds,
			backend: NativeSecret.backend({ silenceWarning: true }),
			source: SecretSource.literal({ data: { url: "u", password: "p" } }),
		});
		expect(b.refLayer).toBeDefined();
	});
});
