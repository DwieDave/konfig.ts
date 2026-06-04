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
 * Add a new `defineLiteral` to the bundle and both sides surface it
 * automatically; rename one and the typechecker flags both call sites.
 */
import { apiEnv } from "@example/env-contracts";
import { Environment } from "@konfig.ts/k8s";
import { Effect, Redacted } from "effect";

const config = await Effect.runPromise(Environment.runtime(apiEnv));

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
			s3: Redacted.value(config.s3.accessKeyId) ? "configured" : "missing",
		});
	},
});

console.log(`api listening on :${port} (pod=${podName}, logLevel=${logLevel})`);
