import { Cause, Console, Effect, Option, Predicate, Runtime, Schema } from "effect"

const _FULL_CAUSE_LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "trace", "all"])

// `--log-level` is a global flag Command.run installs *inside* the program, so
// the failure hook can't read it from context; argv is the one place it is
// visible at the top level.
const _wantsFullCause = (argv: readonly string[]): boolean => {
  const at = argv.indexOf("--log-level")

  const level = at >= 0
    ? argv[at + 1]
    : argv.find((arg) => arg.startsWith("--log-level="))?.slice("--log-level=".length)

  return level !== undefined && _FULL_CAUSE_LOG_LEVELS.has(level.toLowerCase())
}

const _errorFields = (error: Error): string =>
  Object.entries(error)
    .filter(([key, value]) => key !== "_tag" && key !== "cause" && !Predicate.isFunction(value))
    .map(([key, value]) => `${key}=${Predicate.isString(value) ? value : JSON.stringify(value)}`)
    .join(" ")

const _causeText = (cause: unknown): string => Predicate.isError(cause) ? cause.message : String(cause)

const _causeSuffix = (error: Error): string =>
  error.cause === undefined || _causeText(error.cause).length === 0 ? "" : `: ${_causeText(error.cause)}`

const _errorBody = (error: Error): string =>
  error.message.length > 0 ? error.message : `${_errorFields(error)}${_causeSuffix(error)}`

const _TaggedSchema = Schema.Struct({ _tag: Schema.String })

export const _errorLine = (error: Error): string => {
  const tag = Option.match(Schema.decodeUnknownOption(_TaggedSchema)(error), {
    onNone: () => "",
    onSome: (tagged) => `${tagged._tag}: `
  })

  return `${tag}${_errorBody(error)}`
}

// Replaces runMain's default reporter, which logs the whole Cause tree: a
// tagged error's message already says what went wrong. The tree is still
// available under --log-level debug. Interrupts and errors the CLI has
// already rendered (help) stay silent.
export const _reportFailure = (cause: Cause.Cause<unknown>): Effect.Effect<void> => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void
  const error = Cause.squash(cause)

  if (!Runtime.getErrorReported(error)) return Effect.void

  return _wantsFullCause(process.argv)
    ? Console.error(Cause.pretty(cause))
    : Console.error(`konfig: ${Predicate.isError(error) ? _errorLine(error) : String(error)}`)
}
