// workerEnv drives both Environment.bind (infra/modules/worker.ts) and Environment.runtime here.
import { workerEnv } from "@example/env-contracts"
import { Environment } from "@konfig.ts/k8s"
import { Cause, Effect, Schedule } from "effect"

const config = await Effect.runPromise(
  Environment.runtime(workerEnv).pipe(
    Effect.catchCause((cause): Effect.Effect<never> =>
      Effect.gen(function*() {
        yield* Effect.logError(`worker: failed to decode env contract — ${Cause.pretty(cause)}`)
        yield* Effect.logError(
          `worker: check that every env var declared in workerEnv is set (BATCH_SIZE, CONCURRENCY, NODE_ENV, POD_NAME, DATABASE_*)`
        )
        return process.exit(78)
      })
    )
  )
)

const batchSize = config.worker.batchSize
const concurrency = config.worker.concurrency
const podName = config.runtime.podName

const tick = Effect.log(
  `[${podName}] tick — would process ${batchSize} rows (concurrency=${concurrency})`
)

await Effect.runPromise(
  Effect.gen(function*() {
    yield* Effect.log(`worker starting (pod=${podName}, batch=${batchSize}, concurrency=${concurrency})`)
    yield* tick.pipe(Effect.repeat(Schedule.spaced("5 seconds")))
  })
)
