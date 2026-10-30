import { Docker } from "@konfig.ts/docker"

// runner.production re-installs production-only dependencies for the target closure with `bun install --filter`.
export default Docker.app({
  runner: {
    production: true,
    workdir: "/app/apps/api",
    copy: [Docker.copy.workspaceSourceAll()],
    expose: 8080,
    cmd: ["bun", "run", "src/main.ts"],
    env: {
      // per-env values and secrets come from Environment.bind, not here
      LOG_LEVEL: "info"
    },
    healthcheck: Docker.healthcheck.httpGet({
      path: "/healthz",
      port: 8080,
      interval: "15s",
      timeout: "3s",
      retries: 3
    })
  },
  dev: {
    cmd: ["bun", "--watch", "src/main.ts"],
    expose: 8080
  }
})
