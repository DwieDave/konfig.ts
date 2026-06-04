import { ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { defineEnvironment } from "./environment";
import { defineLiteral } from "./literal";
import { defineSecret } from "./secret";
import { runtime } from "./runtime";

describe("Environment.runtime (decoder)", () => {
	it("decodes a single bundle from a ConfigProvider in one effect", async () => {
		const env = defineEnvironment({
			db: defineSecret({
				name: "db-creds",
				namespace: "app",
				env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
			}),
			port: defineLiteral({ envName: "PORT", value: 8080 }),
		});

		const program = runtime(env).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: {
							DATABASE_URL: "postgres://localhost/api",
							DATABASE_PASSWORD: "hunter2",
							PORT: "8080",
						},
					}),
				),
			),
		);
		const decoded = await Effect.runPromise(program);
		expect(Redacted.value(decoded.db.url)).toBe("postgres://localhost/api");
		expect(Redacted.value(decoded.db.password)).toBe("hunter2");
		expect(decoded.port).toBe(8080);
	});
});
