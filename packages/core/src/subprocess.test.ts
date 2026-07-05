import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Sink, Stream } from "effect";
import type { Command } from "effect/unstable/process/ChildProcess";
import { ChildProcess } from "effect/unstable/process";
import {
	type ChildProcessHandle,
	ChildProcessSpawner,
	ExitCode,
	makeHandle,
	make as makeSpawner,
	ProcessId,
} from "effect/unstable/process/ChildProcessSpawner";
import { describe, expect } from "vitest";
import { ProcessError, runProcessExit, runProcessString } from "./subprocess";

interface FakeProc {
	readonly stdout?: string;
	readonly stderr?: string;
	readonly exitCode?: number;
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s));

const _handle = (proc: FakeProc): ChildProcessHandle =>
	makeHandle({
		pid: ProcessId(4242),
		exitCode: Effect.succeed(ExitCode(proc.exitCode ?? 0)),
		isRunning: Effect.succeed(false),
		kill: () => Effect.void,
		stdin: Sink.drain,
		stdout: _bytes(proc.stdout ?? ""),
		stderr: _bytes(proc.stderr ?? ""),
		all: _bytes((proc.stdout ?? "") + (proc.stderr ?? "")),
		getInputFd: () => Sink.drain,
		getOutputFd: () => Stream.empty,
		unref: Effect.succeed(Effect.void),
	} as Parameters<typeof makeHandle>[0]);

const _spawnerFor = (proc: FakeProc): Layer.Layer<ChildProcessSpawner> =>
	Layer.succeed(ChildProcessSpawner, makeSpawner((_command: Command) => Effect.succeed(_handle(proc))));

const _cmd = ChildProcess.make("echo", ["hi"]);

describe("runProcessString", () => {
	it.effect("zero-exit with non-empty stdout returns stdout", () =>
		Effect.gen(function* () {
			const out = yield* runProcessString(_cmd).pipe(
				Effect.provide(_spawnerFor({ stdout: "hello\n", exitCode: 0 })),
			);
			expect(out).toBe("hello\n");
		}),
	);

	it.effect("non-zero exit fails with ProcessError carrying the stderr tail", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProcessString(_cmd).pipe(
					Effect.provide(
						_spawnerFor({ stdout: "", stderr: "boom: bad flag\n", exitCode: 2 }),
					),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const err = exit.cause;
				const text = JSON.stringify(err);
				expect(text).toContain("ProcessError");
				expect(text).toContain("boom: bad flag");
			}
		}),
	);

	it.effect("zero-exit with empty stdout fails when allowEmptyStdout is not set", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProcessString(_cmd).pipe(
					Effect.provide(_spawnerFor({ stdout: "   \n", exitCode: 0 })),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(exit.cause)).toContain("ProcessError");
			}
		}),
	);

	it.effect("zero-exit with empty stdout returns \"\" when allowEmptyStdout is true", () =>
		Effect.gen(function* () {
			const out = yield* runProcessString(_cmd, { allowEmptyStdout: true }).pipe(
				Effect.provide(_spawnerFor({ stdout: "", exitCode: 0 })),
			);
			expect(out).toBe("");
		}),
	);

	it.effect("non-zero exit fails even when allowEmptyStdout is true", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProcessString(_cmd, { allowEmptyStdout: true }).pipe(
					Effect.provide(_spawnerFor({ stdout: "partial", stderr: "nope", exitCode: 1 })),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});

describe("runProcessExit", () => {
	it.effect("zero exit succeeds", () =>
		Effect.gen(function* () {
			yield* runProcessExit(_cmd).pipe(Effect.provide(_spawnerFor({ exitCode: 0 })));
		}),
	);

	it.effect("non-zero exit fails with ProcessError carrying the stderr tail", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProcessExit(_cmd).pipe(
					Effect.provide(_spawnerFor({ stderr: "pull failed", exitCode: 1 })),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(exit.cause)).toContain("pull failed");
			}
		}),
	);
});

describe("ProcessError", () => {
	it("message includes command, exit code, and stderr tail", () => {
		const err = new ProcessError({ command: "helm template x", exitCode: 7, stderrTail: "boom" });
		expect(err._tag).toBe("ProcessError");
		expect(err.message).toContain("helm template x");
		expect(err.message).toContain("exit 7");
		expect(err.message).toContain("boom");
	});

	it.effect("bounds the stderr tail to roughly 2KB (last bytes retained)", () =>
		Effect.gen(function* () {
			const big = `${"x".repeat(5000)}TAILMARKER`;
			const exit = yield* Effect.exit(
				runProcessExit(_cmd).pipe(
					Effect.provide(_spawnerFor({ stderr: big, exitCode: 1 })),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
				const err = exit.cause.error;
				expect(err).toBeInstanceOf(ProcessError);
				if (err instanceof ProcessError) {
					expect(err.stderrTail.length).toBeLessThanOrEqual(2048);
					expect(err.stderrTail).toContain("TAILMARKER");
				}
			}
		}),
	);
});
