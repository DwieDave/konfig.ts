import { Downward, Environment, Literal } from "@konfig.ts/env"
import { Schema } from "effect"
import { dbCreds, jwtKey, s3Creds } from "./secrets"

export const apiEnv = Environment.define({
  db: dbCreds,
  s3: s3Creds,
  jwt: jwtKey,
  http: Environment.define({
    port: Literal.define({
      envName: "HTTP_PORT",
      value: 8080,
      schema: Schema.FiniteFromString
    }),
    logLevel: Literal.define({
      envName: "LOG_LEVEL",
      value: "info",
      schema: Schema.String
    })
  }),
  runtime: Environment.define({
    nodeEnv: Literal.define({ envName: "NODE_ENV", value: "production" }),
    podName: Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" })
  })
})

// Strict subset of apiEnv: shares dbCreds, drops S3/JWT, adds BATCH_SIZE.
export const workerEnv = Environment.define({
  db: dbCreds,
  worker: Environment.define({
    batchSize: Literal.define({
      envName: "BATCH_SIZE",
      value: 100,
      schema: Schema.FiniteFromString
    }),
    concurrency: Literal.define({
      envName: "CONCURRENCY",
      value: 4,
      schema: Schema.FiniteFromString
    })
  }),
  runtime: Environment.define({
    nodeEnv: Literal.define({ envName: "NODE_ENV", value: "production" }),
    podName: Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" })
  })
})
