import { it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { coerce, Yaml } from "@konfig.ts/core";
import { defineSecret, SecretSource } from "@konfig.ts/env";
import { Secret } from "@konfig.ts/k8s";
import { SealedSecrets } from "@konfig.ts/sealed-secrets";
import { Effect, Exit, Layer, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import { type Command, isStandardCommand } from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { describe, expect } from "vitest";
import { Sops } from "./backend";
import type { SopsSecret } from "./crd";

const SOPS_ENCRYPT_OUTPUT = `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  secretTemplates:
    - name: db-creds
      type: Opaque
      stringData:
        url: ENC[AES256_GCM,data:STUBurl==,type:str]
        password: ENC[AES256_GCM,data:STUBpassword==,type:str]
sops:
  age:
    - recipient: age1mockstub
      enc: |
        -----BEGIN AGE ENCRYPTED FILE-----
        STUBPAYLOAD
        -----END AGE ENCRYPTED FILE-----
`.trim();

const KUBESEAL_OUTPUT = `
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  template:
    metadata: { name: db-creds, namespace: prod }
    type: Opaque
  encryptedData:
    url: AgB7nF9CASE_A_STUB==
    password: AgC4kL8CASE_A_STUB==
`.trim();

interface RecordedCall {
	readonly cmd: string;
	readonly args: ReadonlyArray<string>;
	readonly stdin?: string;
}

interface Sink {
	calls: RecordedCall[];
}

const _stdinAsString = (cmd: Command) =>
	Effect.gen(function* () {
		if (!isStandardCommand(cmd)) return undefined;
		const s = cmd.options.stdin;
		if (s === undefined || typeof s === "string") return undefined;
		const chunks = yield* Stream.runCollect(coerce<Stream.Stream<Uint8Array>>(s));
		const merged = Array.from(chunks).flatMap((c) => Array.from(c));
		return new TextDecoder().decode(new Uint8Array(merged));
	});

const _makeStubSpawner = (
	sink: Sink,
	respond: (cmd: Command) => string,
): Layer.Layer<ChildProcessSpawner> =>
	Layer.succeed(ChildProcessSpawner, {
		spawn: () => Effect.die("spawn not used"),
		exitCode: () => Effect.die("exitCode not used"),
		streamString: () => Stream.fail(coerce("not used")),
		streamLines: () => Stream.fail(coerce("not used")),
		lines: () => Effect.die("not used"),
		string: (cmd: Command) =>
			Effect.gen(function* () {
				const stdin = yield* _stdinAsString(cmd);
				if (isStandardCommand(cmd)) {
					sink.calls.push({ cmd: cmd.command, args: cmd.args, stdin });
				}
				return respond(cmd);
			}),
	});

const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const ctx = { env: "prod" } as const;

describe("Sops.backend (case B: konfig source → SopsSecret CR)", () => {
	it.effect("encrypts to a SopsSecret with age recipients", () =>
		Effect.gen(function* () {
			const sink: Sink = { calls: [] };
			const bound = Secret.bind({
				secret: dbCreds,
				backend: Sops.backend({ recipients: { age: ["age1stub00000000000000000000000000000000000000000000000000ends"] } }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const rendered = coerce<SopsSecret>(
				yield* bound.manifest!.render(ctx).pipe(
					Effect.provide(_makeStubSpawner(sink, () => SOPS_ENCRYPT_OUTPUT)),
				),
			);
			expect(rendered.apiVersion).toBe("isindir.github.com/v1alpha3");
			expect(rendered.kind).toBe("SopsSecret");
			expect(rendered.spec.secretTemplates[0]?.stringData?.url).toContain("ENC[");
			const call = sink.calls[0];
			expect(call?.cmd).toBe("sops");
			expect(call?.args).toContain("--encrypt");
			expect(call?.args).toContain("--age");
			expect(call?.args).toContain("age1stub00000000000000000000000000000000000000000000000000ends");
			expect(call?.stdin).toContain("kind: SopsSecret");
			expect(call?.stdin).toContain("url: u");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("Sops.passthrough (case C)", () => {
	it.effect("reads an encrypted file from disk and parses it as a SopsSecret", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const tmpFile = `${process.cwd()}/.tmp-sops-passthrough.yaml`;
			yield* fs.writeFileString(tmpFile, SOPS_ENCRYPT_OUTPUT);
			try {
				const bound = Secret.bind({
					secret: dbCreds,
					backend: Sops.passthrough({ file: tmpFile }),
				});
				const rendered = coerce<SopsSecret>(yield* bound.manifest!.render(ctx));
				expect(rendered.kind).toBe("SopsSecret");
				expect(rendered.spec.secretTemplates[0]?.name).toBe("db-creds");
			} finally {
				yield* fs.remove(tmpFile);
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("Sops.source (case A: sops source → SealedSecrets backend)", () => {
	it.effect("decrypts per-key via sops --extract, feeds kubeseal", () =>
		Effect.gen(function* () {
			const sink: Sink = { calls: [] };
			const respond = (cmd: Command): string => {
				if (!isStandardCommand(cmd)) return "";
				if (cmd.command === "sops") {
					const extractArg = cmd.args[cmd.args.indexOf("--extract") + 1] ?? "";
					if (extractArg.includes("url")) return "u-from-sops";
					if (extractArg.includes("password")) return "p-from-sops";
				}
				if (cmd.command === "kubeseal") return KUBESEAL_OUTPUT;
				return "";
			};
			const bound = Secret.bind({
				secret: dbCreds,
				backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/c.pem" }),
				source: Sops.source({
					file: "/tmp/db-creds.enc.yaml",
					keys: ["url", "password"] as const,
				}),
			});
			const rendered = yield* bound.manifest!.render(ctx).pipe(
				Effect.provide(_makeStubSpawner(sink, respond)),
			);
			const yaml = Yaml.serialize({ value: rendered });
			expect(yaml).toContain("kind: SealedSecret");

			const sopsCalls = sink.calls.filter((c) => c.cmd === "sops");
			expect(sopsCalls).toHaveLength(2);
			expect(sopsCalls[0]?.args).toContain("--decrypt");
			expect(sopsCalls[0]?.args).toContain("--extract");
			expect(sopsCalls[0]?.args).toContain("/tmp/db-creds.enc.yaml");

			const kubesealCall = sink.calls.find((c) => c.cmd === "kubeseal");
			expect(kubesealCall).toBeDefined();
			expect(kubesealCall?.stdin).toContain("u-from-sops");
			expect(kubesealCall?.stdin).toContain("p-from-sops");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("Sops.source error handling", () => {
	it.effect("sops failure surfaces as SecretSourceError → RenderError", () =>
		Effect.gen(function* () {
			const sink: Sink = { calls: [] };
			const respond = (): never => {
				throw new Error("sops not installed");
			};
			const oneKey = defineSecret({
				name: "one-key",
				namespace: "prod",
				env: { url: "URL" },
			});
			const bound = Secret.bind({
				secret: oneKey,
				backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/c.pem" }),
				source: Sops.source({ file: "/x.enc.yaml", keys: ["url"] as const }),
			});
			const exit = yield* Effect.exit(
				bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink, respond))),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("Sops.backend recipient input boundary", () => {
	const VALID_OUTPUT = SOPS_ENCRYPT_OUTPUT;
	const validAge = "age1stub00000000000000000000000000000000000000000000000000ends";

	it.effect("rejects age recipient containing a comma (smuggled second key)", () =>
		Effect.gen(function* () {
			const sink: Sink = { calls: [] };
			const bound = Secret.bind({
				secret: dbCreds,
				backend: Sops.backend({
					recipients: {
						age: [`${validAge},age1injected${"0".repeat(50)}leak`],
					},
				}),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const exit = yield* Effect.exit(
				bound.manifest!.render(ctx).pipe(
					Effect.provide(_makeStubSpawner(sink, () => VALID_OUTPUT)),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const text = JSON.stringify(exit.cause);
				expect(text).toContain("SopsRecipients");
				expect(text).toContain("BoundaryDecodeError");
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("rejects age recipient with shell metachars (semicolon)", () =>
		Effect.gen(function* () {
			const sink: Sink = { calls: [] };
			const bound = Secret.bind({
				secret: dbCreds,
				backend: Sops.backend({
					recipients: { age: [`${validAge}; rm -rf /`] },
				}),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const exit = yield* Effect.exit(
				bound.manifest!.render(ctx).pipe(
					Effect.provide(_makeStubSpawner(sink, () => VALID_OUTPUT)),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("Sops.backend schema boundary", () => {
	const MALFORMED_OUTPUT = `
apiVersion: wrong/v1
kind: NotASopsSecret
metadata:
  name: db-creds
`.trim();

	it.effect("BoundaryDecodeError if sops stdout doesn't match SopsSecret schema", () =>
		Effect.gen(function* () {
			const sink: Sink = { calls: [] };
			const bound = Secret.bind({
				secret: dbCreds,
				backend: Sops.backend({ recipients: { age: ["age1stub00000000000000000000000000000000000000000000000000ends"] } }),
				source: SecretSource.literal({ data: { url: "u", password: "p" } }),
			});
			const exit = yield* Effect.exit(
				bound.manifest!.render(ctx).pipe(
					Effect.provide(_makeStubSpawner(sink, () => MALFORMED_OUTPUT)),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const text = JSON.stringify(exit.cause);
				expect(text).toContain("BoundaryDecodeError");
				expect(text).toContain("SopsSecret");
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
