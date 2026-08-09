import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Cause, ConfigProvider, Effect, Exit } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import * as crypto from "node:crypto"
import * as Helm from "./Helm"
import { RenderContext } from "./RenderContext"
import { HelmDigestMismatch } from "./RenderError"

const _sha256Hex = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex")

interface Fixture {
  readonly cacheDir: string
  readonly chart: string
  readonly version: string
  readonly tarball: Buffer
  readonly digest: string
  readonly cachedTgz: string
}

const _setupFixture: Effect.Effect<Fixture, never, FileSystem | Path> = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const cacheDir = yield* fs.makeTempDirectory({ prefix: "konfig-helm-cache-test-" }).pipe(Effect.orDie)
  const chart = "fixture"
  const version = "1.0.0"
  const tarball = Buffer.from("fake-helm-tarball-bytes\nDocument: kind: ConfigMap\nname: x")
  const digest = `sha256:${_sha256Hex(tarball)}`
  const digestSuffix = digest.replace(/^sha256:/, "").slice(0, 12)
  const cachedTgz = path.join(cacheDir, `${chart}-${version}-${digestSuffix}.tgz`)
  yield* fs.writeFile(cachedTgz, tarball).pipe(Effect.orDie)
  return { cacheDir, chart, version, tarball, digest, cachedTgz }
})

const _configProviderFor = (cacheDir: string) => ConfigProvider.fromUnknown({ KONFIG_HELM_CACHE: cacheDir })

describe("Helm.release digest verification", () => {
  let fixture: Fixture

  beforeEach(() =>
    Effect.runPromise(
      _setupFixture.pipe(
        Effect.provide(NodeServices.layer),
        Effect.map((f) => {
          fixture = f
        })
      )
    )
  )

  afterEach(() =>
    Effect.runPromise(
      Effect.gen(function*() {
        const fs = yield* FileSystem
        yield* fs.remove(fixture.cacheDir, { recursive: true, force: true })
      }).pipe(Effect.provide(NodeServices.layer), Effect.orDie)
    )
  )

  it.effect("returns HelmDigestMismatch if a byte of the cached tarball is flipped", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const tampered = Buffer.from(fixture.tarball)
      tampered[0] = (tampered[0] ?? 0) ^ 0xff
      yield* fs.writeFile(fixture.cachedTgz, tampered)

      const m = Helm.release({
        repo: "https://example.com/charts",
        chart: fixture.chart,
        version: fixture.version,
        digest: fixture.digest,
        values: {}
      })

      const exit = yield* m.render(RenderContext.make("test")).pipe(
        Effect.provide(NodeServices.layer),
        Effect.provideService(ConfigProvider.ConfigProvider, _configProviderFor(fixture.cacheDir)),
        Effect.scoped,
        Effect.exit
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const causeJson = Cause.pretty(exit.cause)
        expect(causeJson).toContain("HelmDigestMismatch")
        expect(causeJson).toContain(fixture.digest)
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it("HelmDigestMismatch class formats a useful message", () => {
    const err = new HelmDigestMismatch({
      chart: "x",
      version: "1.0.0",
      expected: "sha256:aaa",
      actual: "sha256:bbb"
    })
    expect(err._tag).toBe("HelmDigestMismatch")
    expect(err.message).toContain("expected sha256:aaa")
    expect(err.message).toContain("got sha256:bbb")
  })
})
