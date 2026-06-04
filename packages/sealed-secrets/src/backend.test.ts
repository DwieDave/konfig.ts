import { it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { coerce, Yaml } from "@konfig.ts/core";
import { defineSecret, SecretSource } from "@konfig.ts/env";
import { BackendSourceMissing, Secret } from "@konfig.ts/k8s";
import { Effect, Exit, Layer, Stream } from "effect";
import { type Command, isStandardCommand } from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { describe, expect, it as vitestIt } from "vitest";
import { SealedSecrets } from "./backend";
import type { SealedSecret } from "./crd";

const STUB_SEALED_YAML = `
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  template:
    metadata:
      name: db-creds
      namespace: prod
    type: Opaque
  encryptedData:
    url: AgB7nF9stubUrlEncryptedPayload==
    password: AgC4kL8stubPasswordEncryptedPayload==
`.trim();

interface SpawnerSink {
	lastCmd?: Command;
	lastStdin?: string;
}

const _makeStubSpawner = (sink: SpawnerSink, output = STUB_SEALED_YAML) =>
	Layer.succeed(ChildProcessSpawner, {
		spawn: () => Effect.die("spawn not used"),
		exitCode: () => Effect.die("exitCode not used"),
		streamString: () => Stream.fail(coerce("streamString not used")),
		streamLines: () => Stream.fail(coerce("streamLines not used")),
		lines: () => Effect.die("lines not used"),
		string: (cmd: Command) =>
			Effect.gen(function* () {
				sink.lastCmd = cmd;
				if (isStandardCommand(cmd)) {
					const stdinCfg = cmd.options.stdin;
					if (stdinCfg !== undefined && typeof stdinCfg !== "string") {
						const chunks = yield* Stream.runCollect(
							coerce<Stream.Stream<Uint8Array>>(stdinCfg),
						);
						const merged = Array.from(chunks).flatMap((c) => Array.from(c));
						sink.lastStdin = new TextDecoder().decode(new Uint8Array(merged));
					}
				}
				return output;
			}),
	});

const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const ctx = { env: "prod" } as const;

describe("SealedSecrets.backend", () => {
	it.effect("pipes a plaintext Secret to kubeseal and returns the SealedSecret", () =>
		Effect.gen(function* () {
			const sink: SpawnerSink = {};
			const bound = Secret.bind({
				secret: dbCreds,
				backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/cert.pem" }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const rendered = coerce<SealedSecret>(
				yield* bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink))),
			);
			expect(rendered.apiVersion).toBe("bitnami.com/v1alpha1");
			expect(rendered.kind).toBe("SealedSecret");
			expect(rendered.metadata.name).toBe("db-creds");
			expect(rendered.spec.encryptedData.url).toContain("AgB7nF9");
			expect(isStandardCommand(sink.lastCmd!)).toBe(true);
			const std = sink.lastCmd as { command: string; args: ReadonlyArray<string> };
			expect(std.command).toBe("kubeseal");
			expect(std.args).toEqual([
				"--cert",
				"/tmp/cert.pem",
				"--scope",
				"strict",
				"--format",
				"yaml",
			]);
			expect(sink.lastStdin).toContain("kind: Secret");
			expect(sink.lastStdin).toContain("url: u");
			expect(sink.lastStdin).toContain("password: p");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("defaults: scope=strict", () =>
		Effect.gen(function* () {
			const sink: SpawnerSink = {};
			const bound = Secret.bind({
				secret: dbCreds,
				backend: SealedSecrets.backend({ certPath: "/tmp/cert.pem" }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			yield* bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink)));
			const std = sink.lastCmd as { args: ReadonlyArray<string> };
			expect(std.args).toContain("strict");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("reads cert from $KUBESEAL_CERT when certPath omitted", () =>
		Effect.gen(function* () {
			const sink: SpawnerSink = {};
			const original = globalThis.process.env.KUBESEAL_CERT;
			globalThis.process.env.KUBESEAL_CERT = "/from/env.pem";
			try {
				const bound = Secret.bind({
					secret: dbCreds,
					backend: SealedSecrets.backend({ scope: "namespace-wide" }),
					source: SecretSource.literal({ data: { url: "u", password: "p" } }),
				});
				yield* bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink)));
				const std = sink.lastCmd as { args: ReadonlyArray<string> };
				expect(std.args.some((a: string) => a === "/from/env.pem")).toBe(true);
			} finally {
				if (original === undefined) delete globalThis.process.env.KUBESEAL_CERT;
				else globalThis.process.env.KUBESEAL_CERT = original;
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("fails with RenderError when no cert is available", () =>
		Effect.gen(function* () {
			const sink: SpawnerSink = {};
			const original = globalThis.process.env.KUBESEAL_CERT;
			delete globalThis.process.env.KUBESEAL_CERT;
			try {
				const bound = Secret.bind({
					secret: dbCreds,
					backend: SealedSecrets.backend(),
					source: SecretSource.literal({ data: { url: "u", password: "p" } }),
				});
				const exit = yield* Effect.exit(
					bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink))),
				);
				expect(Exit.isFailure(exit)).toBe(true);
			} finally {
				if (original !== undefined) globalThis.process.env.KUBESEAL_CERT = original;
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	vitestIt("throws BackendSourceMissing at bind time when source omitted", () => {
		expect(() =>
			Secret.bind({
				secret: dbCreds,
				backend: SealedSecrets.backend({ certPath: "/x" }),
			}),
		).toThrow(BackendSourceMissing);
	});

	it.effect("YAML output of rendered manifest reads like the spec", () =>
		Effect.gen(function* () {
			const sink: SpawnerSink = {};
			const bound = Secret.bind({
				secret: dbCreds,
				backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/c.pem" }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const rendered = yield* bound.manifest!.render(ctx).pipe(
				Effect.provide(_makeStubSpawner(sink)),
			);
			const yaml = Yaml.serialize({ value: rendered });
			expect(yaml).toContain("apiVersion: bitnami.com/v1alpha1");
			expect(yaml).toContain("kind: SealedSecret");
			expect(yaml).toContain("encryptedData:");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("BoundaryDecodeError if kubeseal stdout doesn't match SealedSecret schema", () =>
		Effect.gen(function* () {
			const sink: SpawnerSink = {};
			const malformed = `apiVersion: bitnami.com/v1alpha1\nkind: NotASealedSecret\nmetadata:\n  name: x\n  namespace: y\nspec:\n  encryptedData:\n    k: v\n`;
			const bound = Secret.bind({
				secret: dbCreds,
				backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/c.pem" }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const exit = yield* Effect.exit(
				bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink, malformed))),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const text = JSON.stringify(exit.cause);
				expect(text).toContain("BoundaryDecodeError");
				expect(text).toContain("SealedSecret");
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
