/**
 * Dummy worker entrypoint — pulls a batch every 5s, no-op in this demo.
 *
 * `workerEnv` (from @example/env-contracts) is the same bundle that
 * drives `Environment.bind` in `infra/modules/worker.ts`; consuming it
 * via `Environment.runtime(workerEnv)` keeps the contract symmetric.
 *
 * Boot fails closed: a `ConfigError` from the runtime decoder prints
 * a structured hint and exits 78 (config error) instead of dumping a
 * raw stack trace.
 */
import { workerEnv } from "@example/env-contracts"
import { Environment } from "@konfig.ts/k8s"
import { Cause, Effect } from "effect"

const config = await Effect.runPromise(
  Environment.runtime(workerEnv).pipe(
    Effect.catchCause((cause): Effect.Effect<never> =>
      Effect.sync((): never => {
        console.error(`worker: failed to decode env contract — ${Cause.pretty(cause)}`)
        console.error(
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

const tick = async () => {
  console.log(
    `[${podName}] tick — would process ${batchSize} rows (concurrency=${concurrency})`
  )
}

console.log(`worker starting (pod=${podName}, batch=${batchSize}, concurrency=${concurrency})`)
setInterval(tick, 5_000)
