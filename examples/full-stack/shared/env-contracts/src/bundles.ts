import { defineDownward, defineEnvironment, defineLiteral } from "@konfig.ts/env";
import { Config } from "effect";
import { dbCreds, jwtKey, s3Creds } from "./secrets";

/**
 * Full env bundle for `apps/api`.
 *
 * Mixes every contract atom konfig.ts/env provides:
 *   - perEnv*: values that change per environment (HTTP_PORT, LOG_LEVEL)
 *   - defineLiteral: values baked into the manifest (NODE_ENV)
 *   - defineDownward: Kubernetes downward-API fields (POD_NAME)
 *   - defineSecret: external creds bound to a backend at composition time
 */
export const apiEnv = defineEnvironment({
	db: dbCreds,
	s3: s3Creds,
	jwt: jwtKey,
	http: defineEnvironment({
		port: defineLiteral({
			envName: "HTTP_PORT",
			value: 8080,
			schema: Config.number("HTTP_PORT").pipe(Config.withDefault(8080)),
		}),
		logLevel: defineLiteral({
			envName: "LOG_LEVEL",
			value: "info",
			schema: Config.string("LOG_LEVEL").pipe(Config.withDefault("info")),
		}),
	}),
	runtime: defineEnvironment({
		nodeEnv: defineLiteral({ envName: "NODE_ENV", value: "production" }),
		podName: defineDownward({ envName: "POD_NAME", fieldPath: "metadata.name" }),
	}),
});

/**
 * Worker bundle. Strict subset of apiEnv:
 *   - shares the same dbCreds (must connect to the same database)
 *   - no S3, no JWT (worker doesn't serve HTTP)
 *   - extra knob: BATCH_SIZE
 */
export const workerEnv = defineEnvironment({
	db: dbCreds,
	worker: defineEnvironment({
		batchSize: defineLiteral({
			envName: "BATCH_SIZE",
			value: 100,
			schema: Config.number("BATCH_SIZE").pipe(Config.withDefault(100)),
		}),
		concurrency: defineLiteral({
			envName: "CONCURRENCY",
			value: 4,
			schema: Config.number("CONCURRENCY").pipe(Config.withDefault(4)),
		}),
	}),
	runtime: defineEnvironment({
		nodeEnv: defineLiteral({ envName: "NODE_ENV", value: "production" }),
		podName: defineDownward({ envName: "POD_NAME", fieldPath: "metadata.name" }),
	}),
});
