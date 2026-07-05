import { ProcessError, runProcessString, unsafeCoerce } from "@konfig.ts/core";
import { Data, Effect, Stream } from "effect";
import { ChildProcess } from "./_unstable";
import type { SopsRecipients } from "./crd";

/**
 * Render the non-sensitive part of a subprocess failure — exit code and a
 * bounded stderr tail. Never stringifies stdout (which for a sops decrypt
 * is the plaintext secret) or an arbitrary cause.
 */
const _processDetail = (cause: unknown): string => {
	if (cause instanceof ProcessError) {
		const tail = cause.stderrTail.trim();
		return tail.length > 0 ? ` (exit ${cause.exitCode}): ${tail}` : ` (exit ${cause.exitCode})`;
	}
	return "";
};

export class SopsInvocationError extends Data.TaggedError("SopsInvocationError")<{
	readonly op: "decrypt" | "encrypt" | "extract";
	readonly cause: unknown;
}> {
	get message(): string {
		return `sops ${this.op} failed${_processDetail(this.cause)}`;
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
		const cmd = ChildProcess.make("sops", [
			"--decrypt",
			"--extract",
			input.extract,
			input.file,
		]);
		const stdout = yield* runProcessString(cmd).pipe(
			Effect.mapError((cause) => new SopsInvocationError({ op: "extract", cause })),
		);
		return stdout.replace(/\n+$/u, "");
	}).pipe(Effect.scoped);

export interface SopsDecryptInput {
	readonly file: string;
}

export const sopsDecrypt = (input: SopsDecryptInput) =>
	Effect.gen(function* () {
		const cmd = ChildProcess.make("sops", ["--decrypt", input.file]);
		return yield* runProcessString(cmd).pipe(
			Effect.mapError((cause) => new SopsInvocationError({ op: "decrypt", cause })),
		);
	}).pipe(Effect.scoped);

export interface SopsEncryptStdinInput {
	readonly plaintextYaml: string;
	readonly recipients: SopsRecipients;
}

export const sopsEncryptStdin = (input: SopsEncryptStdinInput) =>
	Effect.gen(function* () {
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
			stdin: Stream.succeed(unsafeCoerce<Uint8Array>(encoded, "TextEncoder.encode returns Uint8Array — Stream.succeed's inferred type is wider")),
		});
		return yield* runProcessString(cmd).pipe(
			Effect.mapError((cause) => new SopsInvocationError({ op: "encrypt", cause })),
		);
	}).pipe(Effect.scoped);
