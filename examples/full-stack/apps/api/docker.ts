import { Docker } from "@konfig.ts/docker";

/**
 * Production multi-stage + dev single-stage Dockerfile for `apps/api`.
 *
 * The runner stage is workspace-graph-aware: konfig.ts/docker resolves
 * the transitive closure of @example/api (which pulls in
 * @example/env-contracts) and copies only those workspaces into the
 * final image.
 *
 * The `runner.production` flag re-runs `bun install --production` after
 * trimming the root package.json's workspaces to the closure — drops
 * dev dependencies and unused workspace trees from node_modules.
 */
export default Docker.app({
	target: "apps/api",
	runner: {
		production: true,
		workdir: "/app/apps/api",
		copy: [Docker.copy.workspaceSourceAll()],
		expose: 8080,
		cmd: ["bun", "run", "src/main.ts"],
		env: {
			// Only contract atoms with literal defaults belong here.
			// per-env values and secrets come from the Deployment env
			// block (via Environment.bind in the api infra module).
			LOG_LEVEL: "info",
		},
		healthcheck: {
			_tag: "HealthcheckHttpGet",
			path: "/healthz",
			port: 8080,
			interval: "15s",
			timeout: "3s",
			retries: 3,
		},
	},
	dev: {
		cmd: ["bun", "--watch", "src/main.ts"],
		expose: 8080,
	},
});
