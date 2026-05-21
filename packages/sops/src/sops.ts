import { coerce } from "@konfig.ts/core";
import { Data, Effect, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import type { SopsRecipients } from "./crd";

export class SopsInvocationError extends Data.TaggedError("SopsInvocationError")<{
	readonly op: "decrypt" | "encrypt" | "extract";
	readonly cause: unknown;
}> {
	get message(): string {
		return `sops ${this.op} failed: ${String(this.cause)}`;
	}
}

const _recipientArgs = (recipients: SopsRecipients): string[] => {
	const out: string[] = [];
	if (recipients.age !== undefined && recipients.age.length > 0) {
		out.push("--age", recipients.age.join(","));
	}
	if (recipients.kms !== undefined && recipients.kms.length > 0) {
		out.push("--kms", recipients.kms.join(","));
	}
	if (recipients.gcpKms !== undefined && recipients.gcpKms.length > 0) {
		out.push("--gcp-kms", recipients.gcpKms.join(","));
	}
	if (recipients.azureKv !== undefined && recipients.azureKv.length > 0) {
		out.push("--azure-kv", recipients.azureKv.join(","));
	}
	if (recipients.pgp !== undefined && recipients.pgp.length > 0) {
		out.push("--pgp", recipients.pgp.join(","));
	}
	return out;
};

export interface SopsExtractInput {
	readonly file: string;
	readonly extract: string;
}

export const sopsExtract = (input: SopsExtractInput) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner;
		const cmd = ChildProcess.make("sops", [
			"--decrypt",
			"--extract",
			input.extract,
			input.file,
		]);
		const stdout = yield* spawner
			.string(cmd)
			.pipe(Effect.mapError((cause) => new SopsInvocationError({ op: "extract", cause })));
		return stdout.replace(/\n+$/u, "");
	}).pipe(Effect.scoped);

export interface SopsDecryptInput {
	readonly file: string;
}

export const sopsDecrypt = (input: SopsDecryptInput) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner;
		const cmd = ChildProcess.make("sops", ["--decrypt", input.file]);
		return yield* spawner
			.string(cmd)
			.pipe(Effect.mapError((cause) => new SopsInvocationError({ op: "decrypt", cause })));
	}).pipe(Effect.scoped);

export interface SopsEncryptStdinInput {
	readonly plaintextYaml: string;
	readonly recipients: SopsRecipients;
}

export const sopsEncryptStdin = (input: SopsEncryptStdinInput) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner;
		const encoded = new TextEncoder().encode(input.plaintextYaml);
		const args = [
			"--encrypt",
			"--input-type",
			"yaml",
			"--output-type",
			"yaml",
			..._recipientArgs(input.recipients),
			"/dev/stdin",
		];
		const cmd = ChildProcess.make("sops", args, {
			stdin: Stream.succeed(coerce<Uint8Array>(encoded)),
		});
		return yield* spawner
			.string(cmd)
			.pipe(Effect.mapError((cause) => new SopsInvocationError({ op: "encrypt", cause })));
	}).pipe(Effect.scoped);
