import { Docker } from "@konfig.ts/docker"

// runner.production re-runs `bun install --production` after trimming workspaces to the closure.
export default Docker.app({
  target: "apps/api",
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
    healthcheck: {
      _tag: "HealthcheckHttpGet",
      path: "/healthz",
      port: 8080,
      interval: "15s",
      timeout: "3s",
      retries: 3
    }
  },
  dev: {
    cmd: ["bun", "--watch", "src/main.ts"],
    expose: 8080
  }
})
