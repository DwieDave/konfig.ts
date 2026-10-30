import { Config, Duration, Effect, Schema, SchemaIssue } from "effect"
import { DEFAULT_HELM_TIMEOUT_SECONDS, KONFIG_HELM_TIMEOUT_ENV } from "../konfigDefaults"

// How long a network-bound helm call (`pull`, `template`) may run before konfig
// gives up with ProcessTimeout. Without a bound, a `helm pull` that prompts for
// registry credentials sits forever on a closed stdin. KONFIG_HELM_TIMEOUT takes
// a bare number of seconds ("300") or an effect duration ("5 minutes").
const _invalidTimeout = (value: Duration.Duration) =>
  Effect.fail(
    new Config.ConfigError(
      new Schema.SchemaError(
        new SchemaIssue.Pointer(
          [KONFIG_HELM_TIMEOUT_ENV],
          new SchemaIssue.InvalidValue({
            message: `${KONFIG_HELM_TIMEOUT_ENV} must be a positive, finite duration`
          }, value)
        )
      )
    )
  )

const _validTimeout = (value: Duration.Duration) =>
  Duration.isFinite(value) && Duration.isGreaterThan(value, Duration.zero)
    ? Effect.succeed(value)
    : _invalidTimeout(value)

const _timeoutFromEnv: Config.Config<Duration.Duration> = Config.Number(KONFIG_HELM_TIMEOUT_ENV).pipe(
  Config.map(Duration.seconds),
  Config.orElse(() => Config.Duration(KONFIG_HELM_TIMEOUT_ENV)),
  Config.mapEffect(_validTimeout)
)

export const timeout: Config.Config<Duration.Duration> = _timeoutFromEnv.pipe(
  Config.withDefault(Duration.seconds(DEFAULT_HELM_TIMEOUT_SECONDS))
)
