/**
 * Dummy API entrypoint.
 *
 * One declaration covers both manifest emission and runtime decode:
 * `apiEnv` (from @example/env-contracts) drives both `Environment.bind`
 * in `infra/modules/api.ts` (which generates the Deployment's env block
 * + Secret manifests) AND `Environment.runtime(apiEnv)` here (which
 * reads the same env vars at process start and decodes them into the
 * typed record below).
 *
 * Add a new `Literal` to the bundle and both sides surface it
 * automatically; rename one and the typechecker flags both call sites.
 *
 * Boot fails closed: if the runtime decoder hits a `ConfigError`
 * (missing env var, type mismatch, etc.), we print the structured
 * message instead of the raw stack trace and exit 78 (config error),
 * matching the round-2 `_konfig_unsatisfied` DX at the type level.
 */
import { apiEnv } from "@example/env-contracts";
import { Environment } from "@konfig.ts/k8s";
import { Cause, Effect, Redacted } from "effect";

const config = await Effect.runPromise(
	Environment.runtime(apiEnv).pipe(
		Effect.catchCause((cause): Effect.Effect<never> =>
			Effect.sync((): never => {
				console.error(`api: failed to decode env contract — ${Cause.pretty(cause)}`);
				console.error(`api: check that every env var declared in apiEnv is set (HTTP_PORT, LOG_LEVEL, NODE_ENV, POD_NAME, DATABASE_*, S3_*, JWT_SIGNING_KEY)`);
				return process.exit(78);
			}),
		),
	),
);

const port = config.http.port;
const podName = config.runtime.podName;
const logLevel = config.http.logLevel;

Bun.serve({
	port,
	fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/healthz") {
			return new Response("ok", { status: 200 });
		}
		return Response.json({
			service: "api",
			pod: podName,
			logLevel,
			db: Redacted.value(config.db.url) ? "configured" : "missing",
			s3: Redacted.value(config.s3.accessKey) ? "configured" : "missing",
		});
	},
});

console.log(`api listening on :${port} (pod=${podName}, logLevel=${logLevel})`);
