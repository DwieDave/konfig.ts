// apiEnv drives both Environment.bind (infra/modules/api.ts) and Environment.runtime here, kept symmetric.
import { apiEnv } from "@example/env-contracts"
import { Environment } from "@konfig.ts/k8s"
import { Cause, Effect, Redacted } from "effect"

const config = await Effect.runPromise(
  Environment.runtime(apiEnv).pipe(
    Effect.catchCause((cause): Effect.Effect<never> =>
      Effect.gen(function*() {
        yield* Effect.logError(`api: failed to decode env contract — ${Cause.pretty(cause)}`)
        yield* Effect.logError(
          `api: check that every env var declared in apiEnv is set (HTTP_PORT, LOG_LEVEL, NODE_ENV, POD_NAME, DATABASE_*, S3_*, JWT_SIGNING_KEY)`
        )
        return process.exit(78)
      })
    )
  )
)

const port = config.http.port
const podName = config.runtime.podName
const logLevel = config.http.logLevel

Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 })
    }
    return Response.json({
      service: "api",
      pod: podName,
      logLevel,
      db: Redacted.value(config.db.url) ? "configured" : "missing",
      s3: Redacted.value(config.s3.accessKey) ? "configured" : "missing"
    })
  }
})

await Effect.runPromise(Effect.log(`api listening on :${port} (pod=${podName}, logLevel=${logLevel})`))
