import { Data, Effect, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "./_unstable";

/**
 * Exit code stamped on a `ProcessError` when the process never produced
 * one — i.e. the spawn itself failed (binary not found, EACCES, a stream
 * read error). Distinct from any real OS exit code.
 */
const SPAWN_FAILED_EXIT = -1;

/**
 * Upper bound (in UTF-16 code units, a close proxy for bytes here) on the
 * stderr tail retained by `ProcessError` — roughly the last 2KB. Keeps a
 * failing command's diagnostics readable without pinning a runaway log in
 * memory or in the serialized error.
 */
const STDERR_TAIL_LIMIT = 2048;

const _tail = (text: string): string =>
	text.length > STDERR_TAIL_LIMIT ? text.slice(text.length - STDERR_TAIL_LIMIT) : text;

const _commandLabel = (command: ChildProcess.Command): string =>
	ChildProcess.isStandardCommand(command)
		? [command.command, ...command.args].join(" ")
		: "<pipeline>";

/**
 * Failure of a spawned subprocess: a non-zero exit, a spawn that never
 * started, or (for `runProcessString`) an empty stdout when a payload was
 * required. Carries the exit code and a bounded tail of stderr so callers
 * can surface a diagnostic without re-running the command.
 *
 * `command` is the program plus its already-parsed arguments; it must
 * never be interpolated with secret material by callers.
 */
export class ProcessError extends Data.TaggedError("ProcessError")<{
	readonly command: string;
	readonly exitCode: number;
	readonly stderrTail: string;
}> {
	get message(): string {
		const tail = this.stderrTail.trim();
		const suffix = tail.length > 0 ? `: ${tail}` : "";
		return `command \`${this.command}\` failed (exit ${this.exitCode})${suffix}`;
	}
}

interface _CollectedProcess {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

const _collect = (
	stream: Stream.Stream<Uint8Array, PlatformError>,
): Effect.Effect<string, PlatformError> => Stream.mkString(Stream.decodeText(stream));

/**
 * Spawn `command` exactly once and, concurrently, drain stdout and stderr
 * to strings while awaiting the exit code. Draining both pipes alongside
 * `exitCode` avoids the classic pipe-buffer deadlock. A spawn/stream
 * failure (PlatformError) is folded into a `ProcessError` so callers see a
 * single error channel.
 */
const _spawnCollect = (
	command: ChildProcess.Command,
): Effect.Effect<_CollectedProcess, ProcessError, ChildProcessSpawner> =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			const [exitCode, stdout, stderr] = yield* Effect.all(
				[handle.exitCode, _collect(handle.stdout), _collect(handle.stderr)],
				{ concurrency: "unbounded" },
			);
			return { exitCode, stdout, stderr };
		}),
	).pipe(
		Effect.mapError(
			(cause) =>
				new ProcessError({
					command: _commandLabel(command),
					exitCode: SPAWN_FAILED_EXIT,
					stderrTail: _tail(String(cause)),
				}),
		),
	);

/**
 * Run `command` and return its stdout, checking the exit code — the guard
 * that `spawner.string` omits. Fails with `ProcessError` (carrying the
 * stderr tail) on any non-zero exit. Unless `allowEmptyStdout` is `true`,
 * also fails when the trimmed stdout is empty, so a silently-failing
 * command can never masquerade as an empty-but-successful result.
 */
// oxlint-disable-next-line app/no-multiple-function-params
export const runProcessString = (
	command: ChildProcess.Command,
	options?: { readonly allowEmptyStdout?: boolean },
): Effect.Effect<string, ProcessError, ChildProcessSpawner> =>
	Effect.gen(function* () {
		const result = yield* _spawnCollect(command);
		if (result.exitCode !== 0) {
			return yield* new ProcessError({
					command: _commandLabel(command),
					exitCode: result.exitCode,
					stderrTail: _tail(result.stderr),
				});
		}
		if (options?.allowEmptyStdout !== true && result.stdout.trim().length === 0) {
			return yield* new ProcessError({
					command: _commandLabel(command),
					exitCode: result.exitCode,
					stderrTail: _tail(result.stderr),
				});
		}
		return result.stdout;
	});

/**
 * Run `command` for its success/failure only — stdout is drained (to avoid
 * a pipe deadlock) but discarded. Fails with `ProcessError` on any
 * non-zero exit, attaching the stderr tail when present.
 */
export const runProcessExit = (
	command: ChildProcess.Command,
): Effect.Effect<void, ProcessError, ChildProcessSpawner> =>
	Effect.gen(function* () {
		const result = yield* _spawnCollect(command);
		if (result.exitCode !== 0) {
			return yield* new ProcessError({
					command: _commandLabel(command),
					exitCode: result.exitCode,
					stderrTail: _tail(result.stderr),
				});
		}
	});
