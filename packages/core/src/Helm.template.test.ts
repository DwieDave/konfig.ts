import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import {
  Cause,
  ConfigProvider,
  Duration,
  Effect,
  Exit,
  flow,
  Layer,
  Option,
  Redacted,
  Schema,
  Sink,
  Stream
} from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { Command, StandardCommand } from "effect/process/ChildProcess"
import { isStandardCommand } from "effect/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/process/ChildProcessSpawner"
import { unsafeCoerce } from "./_cast"
import { sha256Hex } from "./hash"
import * as Helm from "./Helm"
import { _parseHelmOutput } from "./Helm"
import { RenderContext } from "./RenderContext"
import { HelmRenderError, YamlParseError } from "./RenderError"

const _isString = Schema.is(Schema.String)

const _plainArgs = (command: StandardCommand): ReadonlyArray<string> =>
  command.args.map((arg) => (_isString(arg) ? arg : Redacted.value(arg)))

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

const _handle = (stdout: string, exitCode = 0): ChildProcessHandle =>
  makeHandle(
    {
      pid: ProcessId(1),
      exitCode: Effect.succeed(ExitCode(exitCode)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: _bytes(stdout),
      stderr: _bytes(""),
      all: _bytes(stdout),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void)
    }
  )

/**
 * Fake `helm` binary. `pull` writes a real tarball file into the
 * `--destination` dir (via the ambient `FileSystem`/`Path` services, so the
 * real, un-mocked cache logic in `Helm.ts` has something to find and
 * rename); `template` returns canned multi-doc YAML.
 *
 * `spawn`'s declared signature only requires `Scope.Scope`, but the
 * fake implementation additionally needs `FileSystem | Path` (already
 * supplied by `NodeServices.layer` at every call site below) — the cast
 * documents that gap rather than hiding a real R mismatch.
 */
const _spawnerFor = (input: { readonly tarball: Buffer; readonly templateStdout: string }) =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner(
      unsafeCoerce<Parameters<typeof makeSpawner>[0]>({
        value: (command: Command) =>
          Effect.gen(function*() {
            if (!isStandardCommand(command)) return _handle("")
            const args = _plainArgs(command)

            if (args[0] === "pull") {
              const fs = yield* FileSystem
              const path = yield* Path
              const destIdx = args.indexOf("--destination")
              const dest = args[destIdx + 1] ?? ""
              const chart = args[3] ?? "chart"
              const version = args[args.indexOf("--version") + 1] ?? "0.0.0"
              yield* fs.writeFile(path.join(dest, `${chart}-${version}.tgz`), input.tarball)

              return _handle("")
            }

            if (args[0] === "template") {
              return _handle(input.templateStdout)
            }

            return _handle("")
          }),
        reason: "fake spawner needs FileSystem and Path, supplied by NodeServices.layer at each call site"
      })
    )
  )

const _TemplatedDocSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Struct({ namespace: Schema.optional(Schema.String) }))
})

const _docOf = flow(
  Schema.decodeUnknownOption(_TemplatedDocSchema),
  Option.getOrElse((): typeof _TemplatedDocSchema.Type => ({}))
)

const TEMPLATE_STDOUT = `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
---
apiVersion: v1
kind: ClusterRole
metadata:
  name: reader
rules: []
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: already-set
spec:
  ports: []
`

describe("Helm.release — full pull + template flow (mocked spawner)", () => {
  it.effect("caches the pulled chart, templates it, and patches missing namespaces on namespaced kinds only", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-template-test-" })

      const tarball = Buffer.from("fake-chart-tarball")
      const digest = `sha256:${sha256Hex(tarball)}`

      const m = Helm.release({
        repo: "https://example.com/charts",
        chart: "mychart",
        version: "2.0.0",
        digest,
        namespace: "myns",
        values: { replicaCount: 1 }
      })

      const spawnerLayer = _spawnerFor({ tarball, templateStdout: TEMPLATE_STDOUT })
      const configProvider = ConfigProvider.fromUnknown({ KONFIG_HELM_CACHE: cacheDir })

      const docs = yield* m.render(RenderContext.make("test")).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
        Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
        Effect.scoped
      )

      expect(docs).toHaveLength(3)

      const byKind = (kind: string) => {
        const doc = docs.find((d) => _docOf(d.value).kind === kind)

        return doc === undefined ? undefined : { ..._docOf(doc.value), origin: doc.origin }
      }

      const deployment = byKind("Deployment")
      expect(deployment?.metadata?.namespace).toBe("myns")
      expect(deployment?.origin).toBe("helm:mychart@2.0.0")

      // Cluster-scoped kind must never get a namespace patched in.
      const clusterRole = byKind("ClusterRole")
      expect(clusterRole).toBeDefined()
      expect(clusterRole?.metadata?.namespace).toBeUndefined()

      // A doc that already pins a namespace keeps its own value, not `myns`.
      const service = byKind("Service")
      expect(service?.metadata?.namespace).toBe("already-set")

      // The pulled tarball was cached under the digest-suffixed filename,
      // and the download was renamed rather than left alongside it.
      const cachedFiles = yield* fs.readDirectory(cacheDir)
      expect(cachedFiles).toHaveLength(1)
      expect(cachedFiles[0]).toMatch(/^mychart-2\.0\.0-.+\.tgz$/)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("does not repull when a cached tarball with a matching digest already exists", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-template-cached-" })

      const tarball = Buffer.from("already-cached-bytes")
      const digest = `sha256:${sha256Hex(tarball)}`
      const digestSuffix = digest.replace(/^sha256:/, "").slice(0, 12)
      const cachedTgz = path.join(cacheDir, `mychart-2.0.0-${digestSuffix}.tgz`)
      yield* fs.writeFile(cachedTgz, tarball)

      let pullInvoked = false

      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner,
        makeSpawner((command: Command) => {
          if (isStandardCommand(command) && command.args[0] === "pull") pullInvoked = true

          if (isStandardCommand(command) && command.args[0] === "template") {
            return Effect.succeed(_handle(TEMPLATE_STDOUT))
          }

          return Effect.succeed(_handle(""))
        })
      )

      const m = Helm.release({
        repo: "https://example.com/charts",
        chart: "mychart",
        version: "2.0.0",
        digest,
        values: {}
      })

      const configProvider = ConfigProvider.fromUnknown({ KONFIG_HELM_CACHE: cacheDir })

      const docs = yield* m.render(RenderContext.make("test")).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
        Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
        Effect.scoped
      )

      expect(pullInvoked).toBe(false)
      expect(docs).toHaveLength(3)
    }).pipe(Effect.provide(NodeServices.layer)))

  // it.live: this test relies on a real elapsed-time delay to force the two
  // pulls to interleave, so it must not run against the virtual TestClock
  // that it.effect installs (Effect.sleep would just hang without it being
  // manually advanced).
  it.live(
    "two concurrent releases of the same chart at different versions, sharing a cache, don't misattribute tarballs",
    () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem
        const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-race-test-" })

        const tarballA = Buffer.from("tarball-for-version-a")
        const tarballB = Buffer.from("tarball-for-version-b")
        const digestA = `sha256:${sha256Hex(tarballA)}`
        const digestB = `sha256:${sha256Hex(tarballB)}`

        // Record every `--destination` the two concurrent pulls are given.
        // A pre-fix implementation passes the *shared* cacheDir straight
        // through as `--destination` and instead diffs its directory
        // listing before/after the pull to guess which new file is "mine" —
        // a guess that misattributes tarballs once a second release's pull
        // lands in the same window. The fix pulls into a private
        // per-invocation temp directory and renames the known output, so
        // each recorded destination must be distinct from both the other
        // release's and from cacheDir itself.
        const pullDestinations: string[] = []

        const spawnerLayer = Layer.succeed(
          ChildProcessSpawner,
          makeSpawner(
            unsafeCoerce<Parameters<typeof makeSpawner>[0]>({
              value: (command: Command) =>
                Effect.gen(function*() {
                  if (!isStandardCommand(command)) return _handle("")
                  const args = _plainArgs(command)

                  if (args[0] === "pull") {
                    const fsInner = yield* FileSystem
                    const pathInner = yield* Path
                    const destIdx = args.indexOf("--destination")
                    const dest = args[destIdx + 1] ?? ""
                    const chart = args[3] ?? "chart"
                    const version = args[args.indexOf("--version") + 1] ?? "0.0.0"
                    const tarball = version === "1.0.0" ? tarballA : tarballB
                    pullDestinations.push(dest)

                    if (version === "1.0.0") yield* Effect.sleep("30 millis")
                    yield* fsInner.writeFile(pathInner.join(dest, `${chart}-${version}.tgz`), tarball)

                    return _handle("")
                  }

                  if (args[0] === "template") {
                    return _handle(TEMPLATE_STDOUT)
                  }

                  return _handle("")
                }),
              reason: "fake spawner needs FileSystem and Path, supplied by NodeServices.layer at each call site"
            })
          )
        )

        const configProvider = ConfigProvider.fromUnknown({ KONFIG_HELM_CACHE: cacheDir })

        const releaseA = Helm.release({
          repo: "https://example.com/charts",
          chart: "mychart",
          version: "1.0.0",
          digest: digestA,
          values: {}
        })

        const releaseB = Helm.release({
          repo: "https://example.com/charts",
          chart: "mychart",
          version: "1.0.1",
          digest: digestB,
          values: {}
        })

        const [docsA, docsB] = yield* Effect.all(
          [
            releaseA.render(RenderContext.make("test")),
            releaseB.render(RenderContext.make("test"))
          ],
          { concurrency: "unbounded" }
        ).pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
          Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
          Effect.scoped
        )

        expect(docsA).toHaveLength(3)
        expect(docsB).toHaveLength(3)

        // Each concurrent release cached its own tarball under its own
        // digest-suffixed name — no misattribution — and both pulls landed
        // in distinct private directories, never the shared cacheDir.
        const cachedFiles = yield* fs.readDirectory(cacheDir)
        expect(cachedFiles).toHaveLength(2)
        expect(cachedFiles.some((f) => f.startsWith("mychart-1.0.0-"))).toBe(true)
        expect(cachedFiles.some((f) => f.startsWith("mychart-1.0.1-"))).toBe(true)

        expect(pullDestinations).toHaveLength(2)
        expect(new Set(pullDestinations).size).toBe(2)
        expect(pullDestinations).not.toContain(cacheDir)
      }).pipe(Effect.provide(NodeServices.layer))
  )
})

describe("Helm output parsing", () => {
  it.effect("stamps the namespace onto docs whose metadata.namespace is null", () =>
    Effect.gen(function*() {
      const docs = yield* _parseHelmOutput({
        output: "kind: ConfigMap\nmetadata:\n  name: a\n  namespace: null\n",
        chart: "c",
        version: "1.0.0",
        namespace: "myns"
      })

      expect(_docOf(docs[0]?.value).metadata?.namespace).toBe("myns")
    }))

  it.effect("fails with YamlParseError on malformed output", () =>
    Effect.gen(function*() {
      const err = yield* Effect.flip(
        _parseHelmOutput({ output: "a: [", chart: "c", version: "1", namespace: undefined })
      )

      expect(err).toBeInstanceOf(YamlParseError)
      expect(new YamlParseError({ reasons: ["x"] }).message).toContain("x")
    }))

  it.effect("surfaces malformed helm output as HelmRenderError in the parse phase", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-parse-test-" })
      const tarball = Buffer.from("fake-chart-tarball")

      const m = Helm.release({
        repo: "https://example.com/charts",
        chart: "mychart",
        version: "2.0.0",
        digest: `sha256:${sha256Hex(tarball)}`,
        values: {}
      })

      const err = yield* Effect.flip(m.render(RenderContext.make("test"))).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, _spawnerFor({ tarball, templateStdout: "a: [\n" }))),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ KONFIG_HELM_CACHE: cacheDir })
        ),
        Effect.scoped
      )

      expect(err).toBeInstanceOf(HelmRenderError)
      expect(err).toHaveProperty("phase", "parse")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Helm.timeout validation", () => {
  const _run = (value: string) =>
    Helm.timeout.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ KONFIG_HELM_TIMEOUT: value })),
      Effect.exit
    )

  it.effect("rejects 0, negative and NaN with an error naming the variable", () =>
    Effect.gen(function*() {
      for (const bad of ["0", "-5", "NaN"]) {
        const exit = yield* _run(bad)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "ok").toContain("KONFIG_HELM_TIMEOUT")
      }
    }))

  it.effect("accepts a positive number of seconds and an effect duration", () =>
    Effect.gen(function*() {
      expect(Exit.isSuccess(yield* _run("90"))).toBe(true)
      const exit = yield* _run("2 minutes")
      expect(Exit.isSuccess(exit) && Duration.toSeconds(exit.value)).toBe(120)
    }))
})
