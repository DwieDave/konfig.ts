import { Docker } from "@konfig.ts/docker"

/**
 * Worker Dockerfile. Mirrors apps/api but no port + no healthcheck.
 *
 * Demonstrates `runner.removePaths`: even though the worker shares the
 * monorepo's node_modules, it doesn't need any of the http/server deps.
 * Listing them here drops them from the final runner image without
 * touching the source tree.
 */
export default Docker.app({
  target: "apps/worker",
  runner: {
    production: true,
    workdir: "/app/apps/worker",
    copy: [Docker.copy.workspaceSourceAll()],
    cmd: ["bun", "run", "src/main.ts"],
    removePaths: ["/app/node_modules/typescript"]
  },
  dev: {
    cmd: ["bun", "--watch", "src/main.ts"]
  }
})
