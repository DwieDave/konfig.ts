import { Docker } from "@konfig.ts/docker"

// removePaths drops unneeded deps from the shared node_modules without touching the source tree.
// The `*` glob covers bun's isolated-linker store (node_modules/.bun/<name>@<version>) without pinning a version.
export default Docker.app({
  target: "apps/worker",
  runner: {
    production: true,
    workdir: "/app/apps/worker",
    copy: [Docker.copy.workspaceSourceAll()],
    cmd: ["bun", "run", "src/main.ts"],
    removePaths: ["/app/node_modules/typescript", "/app/node_modules/.bun/typescript@*"]
  },
  dev: {
    cmd: ["bun", "--watch", "src/main.ts"]
  }
})
