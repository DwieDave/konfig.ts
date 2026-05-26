import { it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Redacted } from "effect";
import { describe, expect } from "vitest";
import { defineEnvironment } from "./environment";
import { environmentLayer, type EnvironmentShape } from "./layer";
import { defineLiteral } from "./literal";
import { defineSecret } from "./secret";

const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const port = defineLiteral({ envName: "PORT", value: 8080 });

const apiEnv = defineEnvironment({ db: dbCreds, port });
type ApiEnvShape = EnvironmentShape<typeof apiEnv.members>;

class ApiEnv extends Context.Service<ApiEnv, ApiEnvShape>()("ApiEnv") {}

const fakeEnv = ConfigProvider.layer(
	ConfigProvider.fromEnv({
		env: {
			DATABASE_URL: "postgres://localhost/api",
			DATABASE_PASSWORD: "hunter2",
		},
	}),
);

describe("environmentLayer", () => {
	it.effect("provides the yielded bundle as a Context service", () =>
		Effect.gen(function* () {
			const env = yield* ApiEnv;
			expect(env.port).toBe(8080);
			expect(Redacted.value(env.db.url)).toBe("postgres://localhost/api");
			expect(Redacted.value(env.db.password)).toBe("hunter2");
		}).pipe(Effect.provide(environmentLayer(ApiEnv, apiEnv)), Effect.provide(fakeEnv)),
	);

	it.effect("yields are typed end-to-end", () =>
		Effect.gen(function* () {
			const env = yield* ApiEnv;
			// `port` is number (defineLiteral<"PORT", number>) — not string.
			const portPlus: number = env.port + 1;
			expect(portPlus).toBe(8081);
		}).pipe(Effect.provide(environmentLayer(ApiEnv, apiEnv)), Effect.provide(fakeEnv)),
	);
});

// Compile-time: EnvironmentShape is the structural type of `yield* env`.
type _Shape = {
	db: { url: Redacted.Redacted<string>; password: Redacted.Redacted<string> };
	port: number;
};
type _SameShape = ApiEnvShape extends _Shape ? (_Shape extends ApiEnvShape ? true : false) : false;
const _assertShapeMatches: _SameShape = true;
void _assertShapeMatches;
