/**
 * Dummy API entrypoint.
 *
 * Reads the same env vars that `apiEnv` (from @example/env-contracts)
 * declares at the manifest level — that's the point of env-contracts:
 * one declaration covers both the runtime config decoder and the k8s
 * Deployment env block.
 */
const port = Number(process.env.HTTP_PORT ?? 8080);
const podName = process.env.POD_NAME ?? "local";

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
			db: process.env.DATABASE_URL ? "configured" : "missing",
			s3: process.env.S3_ACCESS_KEY_ID ? "configured" : "missing",
		});
	},
});

console.log(`api listening on :${port} (pod=${podName})`);
