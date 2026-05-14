// M9 — verify the 5 Key constructors yield + provide + run cleanly.

import { Effect, Layer } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	Application,
	ConfigMap,
	Namespace,
	Secret,
	ServiceAccount,
} from "./deps";
import type {
	ApplicationReq,
	ConfigMapRef,
	ConfigMapReq,
	NamespaceReq,
	SecretRef,
	SecretReq,
	ServiceAccountRef,
	ServiceAccountReq,
} from "./deps";

describe("deps — yieldable Key constructors", () => {
	it("Secret(name): yielding lifts SecretReq<N> into R, layer discharges", async () => {
		const prog = Effect.gen(function* () {
			const ref = yield* Secret("postgres-credentials");
			return ref;
		});
		expectTypeOf(prog).toMatchTypeOf<
			Effect.Effect<SecretRef<"postgres-credentials">, never, SecretReq<"postgres-credentials">>
		>();
		const result = await Effect.runPromise(
			prog.pipe(
				Effect.provide(
					Layer.succeed(Secret("postgres-credentials"))(
						"postgres-credentials" as SecretRef<"postgres-credentials">,
					),
				),
			),
		);
		expect(result).toBe("postgres-credentials");
	});

	it("Two distinct Secret names produce two distinct R slots", async () => {
		const prog = Effect.gen(function* () {
			const a = yield* Secret("a");
			const b = yield* Secret("b");
			return { a, b };
		});
		expectTypeOf(prog).toMatchTypeOf<
			Effect.Effect<unknown, never, SecretReq<"a"> | SecretReq<"b">>
		>();
		const result = await Effect.runPromise(
			prog.pipe(
				Effect.provide(
					Layer.mergeAll(
						Layer.succeed(Secret("a"))("a" as SecretRef<"a">),
						Layer.succeed(Secret("b"))("b" as SecretRef<"b">),
					),
				),
			),
		);
		expect(result).toEqual({ a: "a", b: "b" });
	});

	it("ConfigMap, Namespace, ServiceAccount, Application all behave the same", async () => {
		const prog = Effect.gen(function* () {
			const cm = yield* ConfigMap("settings");
			const ns = yield* Namespace("prod");
			const sa = yield* ServiceAccount("worker");
			const app = yield* Application("api");
			return { cm, ns, sa, app };
		});
		expectTypeOf(prog).toMatchTypeOf<
			Effect.Effect<
				unknown,
				never,
				| ConfigMapReq<"settings">
				| NamespaceReq<"prod">
				| ServiceAccountReq<"worker">
				| ApplicationReq<"api">
			>
		>();
		const result = await Effect.runPromise(
			prog.pipe(
				Effect.provide(
					Layer.mergeAll(
						Layer.succeed(ConfigMap("settings"))("settings" as ConfigMapRef<"settings">),
						Layer.succeed(Namespace("prod"))("prod"),
						Layer.succeed(ServiceAccount("worker"))(
							"worker" as ServiceAccountRef<"worker">,
						),
						Layer.succeed(Application("api"))("api"),
					),
				),
			),
		);
		expect(result).toEqual({
			cm: "settings",
			ns: "prod",
			sa: "worker",
			app: "api",
		});
	});

	it("Two calls with the same name resolve to the same provider value", async () => {
		// Each `Secret("same")` call constructs a fresh Service object,
		// but they share the same `key` string ("Secret:same"), and
		// Context lookup is key-string-based. Both yields read the same
		// provided value.
		const prog = Effect.gen(function* () {
			const a = yield* Secret("same");
			const b = yield* Secret("same");
			return { a, b };
		});
		const result = await Effect.runPromise(
			prog.pipe(
				Effect.provide(Layer.succeed(Secret("same"))("same" as SecretRef<"same">)),
			),
		);
		expect(result).toEqual({ a: "same", b: "same" });
	});
});
