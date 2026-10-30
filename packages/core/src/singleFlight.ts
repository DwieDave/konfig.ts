import { Cause, Deferred, Effect, Exit } from "effect"

export interface FlightStore<K, A, E> {
  readonly get: (key: K) => Deferred.Deferred<A, E> | undefined
  readonly set: (key: K, value: Deferred.Deferred<A, E>) => void
  readonly delete: (key: K) => void
}

export interface SingleFlightInput<K, A, E, R> {
  readonly store: FlightStore<K, A, E>
  readonly key: K
  readonly run: Effect.Effect<A, E, R>
  readonly keepOnSuccess: boolean
}

const _interrupted = <A, E>(exit: Exit.Exit<A, E>) => Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

const _settle =
  <K, A, E, R>(input: SingleFlightInput<K, A, E, R> & { readonly deferred: Deferred.Deferred<A, E> }) =>
  (exit: Exit.Exit<A, E>) =>
    Effect.sync(() => {
      if (!input.keepOnSuccess || Exit.isFailure(exit)) input.store.delete(input.key)
    }).pipe(Effect.andThen(Deferred.done(input.deferred, exit)))

const _await = <K, A, E, R>(
  input: SingleFlightInput<K, A, E, R> & { readonly existing: Deferred.Deferred<A, E> }
): Effect.Effect<A, E, R> =>
  Effect.exit(Deferred.await(input.existing)).pipe(
    Effect.flatMap((exit) => _interrupted(exit) ? singleFlight(input) : exit)
  )

export const singleFlight = <K, A, E, R>(input: SingleFlightInput<K, A, E, R>): Effect.Effect<A, E, R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      const existing = input.store.get(input.key)

      if (existing !== undefined) return yield* restore(_await({ ...input, existing }))

      const deferred = yield* Deferred.make<A, E>()
      input.store.set(input.key, deferred)

      return yield* Effect.onExit(restore(input.run), _settle({ ...input, deferred }))
    })
  )
