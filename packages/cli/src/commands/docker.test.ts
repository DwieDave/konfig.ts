import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Console, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { diffEffect, diffOne, emitFor, loadSpec, previewEffect, writeAtomic, writeEffect, writeOne } from "./docker"

const minimalSpecBody = `
import { makeDockerApp } from "@konfig.ts/docker"
export default makeDockerApp({
  target: "IGNORED",
  runner: {
    workdir: "/app/packages/app",
    copy: [{ _tag: "BuilderArtifact", src: "dist", dst: "dist" }],
    cmd: ["bun", "run", "dist/main.js"]
  }
})
`

const withDevSpecBody = `
import { makeDockerApp } from "@konfig.ts/docker"
export default makeDockerApp({
  target: "IGNORED",
  runner: {
    workdir: "/app/packages/app",
    copy: [{ _tag: "BuilderArtifact", src: "dist", dst: "dist" }],
    cmd: ["bun", "run", "dist/main.js"]
  },
  dev: {
    cmd: ["bun", "--watch", "main.ts"]
  }
})
`

const notADockerAppBody = `export default { hello: "world" }`

const syntaxErrorBody = `export default {{{`

const _capturingConsole = (lines: Array<string>): Console.Console =>
  Object.assign(Object.create(globalThis.console), {
    log: (...args: ReadonlyArray<unknown>) => {
      lines.push(args.map(String).join(" "))
    }
  })

const _makeMonorepo = (fs: FileSystem, p: Path, root: string) =>
  Effect.gen(function*() {
    yield* fs.makeDirectory(p.join(root, "packages", "app"), { recursive: true })
    yield* fs.writeFileString(
      p.join(root, "package.json"),
      `{"name":"fixture-root","private":true,"packageManager":"bun@1.3.5","workspaces":["packages/*"]}`
    )
    yield* fs.writeFileString(
      p.join(root, "packages", "app", "package.json"),
      `{"name":"@fixture/app","version":"0.0.0","engines":{"bun":"1.3.5"}}`
    )
  })

describe("loadSpec", () => {
  it.effect("resolves a valid docker.ts spec relative to the monorepo root", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)

      const load = yield* loadSpec(target)
      expect(load.targetAbs).toBe(target)
      expect(load.specPath).toBe(p.join("packages", "app", "docker.ts"))
      expect(load.app.spec.runner.workdir).toBe("/app/packages/app")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with SpecImportError when docker.ts has a syntax error", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), syntaxErrorBody)

      const failure = yield* Effect.flip(loadSpec(target))
      expect(failure._tag).toBe("SpecImportError")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with SpecImportError when docker.ts does not exist", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")

      const failure = yield* Effect.flip(loadSpec(target))
      expect(failure._tag).toBe("SpecImportError")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with SpecNotADockerApp when the default export is not a DockerApp", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), notADockerAppBody)

      const failure = yield* Effect.flip(loadSpec(target))
      expect(failure._tag).toBe("SpecNotADockerApp")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with MonorepoRootNotFound when no workspace root exists above target", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-orphan-" })
      const target = p.join(root, "lonely")
      yield* fs.makeDirectory(target, { recursive: true })
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)

      const failure = yield* Effect.flip(loadSpec(target))
      expect(failure._tag).toBe("MonorepoRootNotFound")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("emitFor", () => {
  it.effect("renders a Dockerfile body from a loaded spec", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)

      const load = yield* loadSpec(target)
      const emitted = yield* emitFor(load)
      expect(emitted.dockerfile).toContain("konfig-managed: @konfig.ts/docker")
      expect(emitted.dockerfile).toContain(`spec: ${load.specPath}`)
      expect(emitted.dockerfileDev).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("writeAtomic", () => {
  it.effect("writes content to the destination path", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-atomic-" })
      const dest = p.join(dir, "Dockerfile")
      yield* writeAtomic({ fs, path: dest, content: "FROM scratch\n" })
      const content = yield* fs.readFileString(dest)
      expect(content).toBe("FROM scratch\n")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with DockerWriteError when the destination directory does not exist", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-atomic-" })
      const dest = p.join(dir, "missing-subdir", "Dockerfile")
      const failure = yield* Effect.flip(writeAtomic({ fs, path: dest, content: "FROM scratch\n" }))
      expect(failure._tag).toBe("DockerWriteError")
      expect(failure.path).toBe(dest)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("writeOne", () => {
  it.effect("writes a new file that does not yet exist", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-writeone-" })
      const dest = p.join(dir, "Dockerfile")
      const r = yield* writeOne({ dest, content: "FROM scratch\n", force: false })
      expect(r.written).toBe(true)
      expect(yield* fs.readFileString(dest)).toBe("FROM scratch\n")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("refuses to overwrite an unmanaged existing file without --force", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-writeone-" })
      const dest = p.join(dir, "Dockerfile")
      yield* fs.writeFileString(dest, "FROM alpine\n# hand-written\n")

      const failure = yield* Effect.flip(writeOne({ dest, content: "FROM scratch\n", force: false }))
      expect(failure._tag).toBe("DockerWriteRefused")
      expect(failure.path).toBe(dest)
      expect(yield* fs.readFileString(dest)).toBe("FROM alpine\n# hand-written\n")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("overwrites an unmanaged existing file when force is set", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-writeone-" })
      const dest = p.join(dir, "Dockerfile")
      yield* fs.writeFileString(dest, "FROM alpine\n# hand-written\n")

      const r = yield* writeOne({ dest, content: "FROM scratch\n", force: true })
      expect(r.written).toBe(true)
      expect(yield* fs.readFileString(dest)).toBe("FROM scratch\n")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("is a no-op when the managed destination already matches the emitted content", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-writeone-" })
      const dest = p.join(dir, "Dockerfile")
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)
      const load = yield* loadSpec(target)
      const emitted = yield* emitFor(load)
      yield* fs.writeFileString(dest, emitted.dockerfile)

      const r = yield* writeOne({ dest, content: emitted.dockerfile, force: false })
      expect(r.written).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("rewrites a managed destination whose content has drifted", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-writeone-" })
      const dest = p.join(dir, "Dockerfile")
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)
      const load = yield* loadSpec(target)
      const emitted = yield* emitFor(load)
      yield* fs.writeFileString(dest, emitted.dockerfile)

      const newEmitted = `${emitted.dockerfile}\n# extra line\n`
      const r = yield* writeOne({ dest, content: newEmitted, force: false })
      expect(r.written).toBe(true)
      expect(yield* fs.readFileString(dest)).toBe(newEmitted)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("diffOne", () => {
  it.effect("succeeds without error when the on-disk header hash matches", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-diffone-" })
      const dest = p.join(dir, "Dockerfile")
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)
      const load = yield* loadSpec(target)
      const emitted = yield* emitFor(load)
      yield* fs.writeFileString(dest, emitted.dockerfile)

      yield* diffOne({ dest, emitted: emitted.dockerfile, kind: "prod", target: "packages/app", format: "summary" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with DiffDrift when on-disk content differs from the emitted content", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-diffone-" })
      const dest = p.join(dir, "Dockerfile")
      yield* fs.writeFileString(dest, "FROM alpine\n")

      const failure = yield* Effect.flip(
        diffOne({ dest, emitted: "FROM scratch\n", kind: "dev", target: "packages/app", format: "summary" })
      )
      expect(failure._tag).toBe("DiffDrift")
      expect(failure.target).toBe("packages/app")
      expect(failure.kind).toBe("dev")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with DiffDrift when the destination is entirely missing", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-diffone-" })
      const dest = p.join(dir, "Dockerfile")

      const failure = yield* Effect.flip(
        diffOne({ dest, emitted: "FROM scratch\n", kind: "prod", target: "packages/app", format: "json" })
      )
      expect(failure._tag).toBe("DiffDrift")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("previewEffect", () => {
  it.effect("succeeds for a valid spec without touching the filesystem", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)

      yield* previewEffect({ target, prodOnly: false, devOnly: false })
      const entries = yield* fs.readDirectory(target)
      expect(entries.sort()).toEqual(["docker.ts", "package.json"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("propagates SpecNotADockerApp for a malformed spec", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), notADockerAppBody)

      const failure = yield* Effect.flip(previewEffect({ target, prodOnly: false, devOnly: false }))
      expect(failure._tag).toBe("SpecNotADockerApp")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("prints both prod and dev Dockerfiles for a spec with a dev stage", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), withDevSpecBody)
      const lines: Array<string> = []

      yield* previewEffect({ target, prodOnly: false, devOnly: false }).pipe(
        Effect.provideService(Console.Console, _capturingConsole(lines))
      )

      const joined = lines.join("\n")
      expect(joined).toContain("konfig-managed: @konfig.ts/docker")
      expect(joined).toContain("---- Dockerfile.dev ----")
      expect(joined).toContain(`CMD ["bun","--watch","main.ts"]`)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("writeEffect", () => {
  it.effect("writes Dockerfile next to the target by default", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)

      yield* writeEffect({
        target,
        outDir: { _tag: "None" },
        prodOnly: false,
        devOnly: false,
        force: false
      })

      const written = yield* fs.readFileString(p.join(target, "Dockerfile"))
      expect(written).toContain("konfig-managed: @konfig.ts/docker")
      const devExists = yield* fs.exists(p.join(target, "Dockerfile.dev"))
      expect(devExists).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("writes to a custom --out-dir when provided", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)
      const outDir = p.join(root, "dist-docker")
      yield* fs.makeDirectory(outDir, { recursive: true })

      yield* writeEffect({
        target,
        outDir: { _tag: "Some", value: outDir },
        prodOnly: false,
        devOnly: false,
        force: false
      })

      const written = yield* fs.readFileString(p.join(outDir, "Dockerfile"))
      expect(written).toContain("konfig-managed: @konfig.ts/docker")
      const inTargetExists = yield* fs.exists(p.join(target, "Dockerfile"))
      expect(inTargetExists).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("skips writing Dockerfile when devOnly is set", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)

      yield* writeEffect({
        target,
        outDir: { _tag: "None" },
        prodOnly: false,
        devOnly: true,
        force: false
      })

      const dockerfileExists = yield* fs.exists(p.join(target, "Dockerfile"))
      expect(dockerfileExists).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("propagates DockerWriteRefused when the destination is unmanaged", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)
      yield* fs.writeFileString(p.join(target, "Dockerfile"), "FROM alpine\n# hand-written\n")

      const failure = yield* Effect.flip(
        writeEffect({ target, outDir: { _tag: "None" }, prodOnly: false, devOnly: false, force: false })
      )
      expect(failure._tag).toBe("DockerWriteRefused")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("also writes Dockerfile.dev when the spec declares a dev stage", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), withDevSpecBody)

      yield* writeEffect({
        target,
        outDir: { _tag: "None" },
        prodOnly: false,
        devOnly: false,
        force: false
      })

      const dev = yield* fs.readFileString(p.join(target, "Dockerfile.dev"))
      expect(dev).toContain("konfig-managed: @konfig.ts/docker")
      expect(dev).toContain(`CMD ["bun","--watch","main.ts"]`)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("skips Dockerfile.dev when prodOnly is set even if the spec declares a dev stage", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), withDevSpecBody)

      yield* writeEffect({
        target,
        outDir: { _tag: "None" },
        prodOnly: true,
        devOnly: false,
        force: false
      })

      const devExists = yield* fs.exists(p.join(target, "Dockerfile.dev"))
      expect(devExists).toBe(false)
      const prodExists = yield* fs.exists(p.join(target, "Dockerfile"))
      expect(prodExists).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("diffEffect", () => {
  it.effect("succeeds when on-disk Dockerfile matches the emitted spec", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)
      const load = yield* loadSpec(target)
      const emitted = yield* emitFor(load)
      yield* fs.writeFileString(p.join(target, "Dockerfile"), emitted.dockerfile)

      yield* diffEffect({ target, format: "summary" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with DiffDrift when the on-disk Dockerfile has drifted", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)
      yield* fs.writeFileString(p.join(target, "Dockerfile"), "FROM alpine\n# stale\n")

      const failure = yield* Effect.flip(diffEffect({ target, format: "summary" }))
      expect(failure._tag).toBe("DiffDrift")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with DiffDrift when the Dockerfile is entirely missing on disk", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), minimalSpecBody)

      const failure = yield* Effect.flip(diffEffect({ target, format: "summary" }))
      expect(failure._tag).toBe("DiffDrift")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("checks Dockerfile.dev too and reports drift with kind \"dev\"", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), withDevSpecBody)
      const load = yield* loadSpec(target)
      const emitted = yield* emitFor(load)
      yield* fs.writeFileString(p.join(target, "Dockerfile"), emitted.dockerfile)
      yield* fs.writeFileString(p.join(target, "Dockerfile.dev"), "FROM alpine\n# stale dev\n")

      const failure = yield* Effect.flip(diffEffect({ target, format: "summary" }))
      expect(failure._tag).toBe("DiffDrift")
      expect((failure as { kind: string }).kind).toBe("dev")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("succeeds when both Dockerfile and Dockerfile.dev match the emitted spec", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const p = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-docker-cmd-" })
      yield* _makeMonorepo(fs, p, root)
      const target = p.join(root, "packages", "app")
      yield* fs.writeFileString(p.join(target, "docker.ts"), withDevSpecBody)
      const load = yield* loadSpec(target)
      const emitted = yield* emitFor(load)
      yield* fs.writeFileString(p.join(target, "Dockerfile"), emitted.dockerfile)
      if (emitted.dockerfileDev) {
        yield* fs.writeFileString(p.join(target, "Dockerfile.dev"), emitted.dockerfileDev)
      }

      yield* diffEffect({ target, format: "summary" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
