import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Sink, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { type Command, isStandardCommand } from "effect/process/ChildProcess"
import {
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/process/ChildProcessSpawner"
import fc from "fast-check"
import { createHash } from "node:crypto"
import { describe, expect } from "vitest"
import { cacheFileName, ensureChartTarball, pullArgs } from "./Helm"
import { HelmDigestMismatch, HelmRenderError } from "./RenderError"

describe("pullArgs", () => {
  it("property: always embeds repo, chart, version and destination after their flags", () => {
    const word = fc.stringMatching(/^[a-z0-9.-]{1,12}$/)
    fc.assert(
      fc.property(word, word, word, word, (repo, chart, version, destination) => {
        const args = pullArgs({ repo, chart, version, destination })
        expect(args[0]).toBe("pull")
        expect(args[args.indexOf("--repo") + 1]).toBe(repo)
        expect(args[args.indexOf("--version") + 1]).toBe(version)
        expect(args[args.indexOf("--destination") + 1]).toBe(destination)
        expect(args).toContain(chart)
      })
    )
  })
})

const _sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const _content = new Uint8Array([1, 2, 3])

const _spawner = (opts: { readonly files: ReadonlyArray<string>; readonly pulls: { count: number } }) =>
  Layer.effect(
    ChildProcessSpawner,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      return makeSpawner((command: Command) =>
        Effect.gen(function*() {
          const args = isStandardCommand(command) ? command.args.map(String) : []
          opts.pulls.count += 1
          const dest = args[args.indexOf("--destination") + 1] ?? ""
          yield* Effect.forEach(opts.files, (f) => fs.writeFile(path.join(dest, f), _content))

          return makeHandle(
            {
              pid: ProcessId(1),
              exitCode: Effect.succeed(ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void)
            }
          )
        })
      )
    })
  )

const _run = (opts: { readonly files: ReadonlyArray<string>; readonly digest?: string; readonly seed?: boolean }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const root = yield* fs.makeTempDirectoryScoped()
    const cacheDir = path.join(root, "cache")
    const pulls = { count: 0 }
    const input = { repo: "https://r", chart: "web", version: "1.0.0", cacheDir, digest: opts.digest }

    if (opts.seed === true) {
      yield* fs.makeDirectory(cacheDir, { recursive: true })
      yield* fs.writeFile(path.join(cacheDir, cacheFileName(input)), _content)
    }

    const exit = yield* Effect.exit(
      ensureChartTarball(input).pipe(Effect.provide(_spawner({ files: opts.files, pulls })))
    )

    const slot = path.join(cacheDir, cacheFileName(input))
    const entries = yield* fs.readDirectory(cacheDir)

    return { exit, pulls: pulls.count, slotExists: yield* fs.exists(slot), entries, slot }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

const _failure = (exit: Exit.Exit<unknown, unknown>) => Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined

describe("ensureChartTarball", () => {
  it.effect("cache miss pulls and renames into the plain slot, removing the temp dir", () =>
    Effect.gen(function*() {
      const r = yield* _run({ files: ["web-1.0.0.tgz"] })
      expect(Exit.isSuccess(r.exit)).toBe(true)
      expect(r.pulls).toBe(1)
      expect(r.entries).toEqual(["web-1.0.0.tgz"])
    }))

  it.effect("cache hit does not spawn", () =>
    Effect.gen(function*() {
      const r = yield* _run({ files: ["web-1.0.0.tgz"], seed: true })
      expect(Exit.isSuccess(r.exit)).toBe(true)
      expect(r.pulls).toBe(0)
    }))

  it.effect("matching digest uses the digest-suffixed slot", () =>
    Effect.gen(function*() {
      const r = yield* _run({ files: ["web-1.0.0.tgz"], digest: _sha(_content) })
      expect(Exit.isSuccess(r.exit)).toBe(true)
      expect(r.slotExists).toBe(true)
      expect(r.slot).toContain(_sha(_content).slice(7, 19))
    }))

  it.effect("digest mismatch fails and never promotes the tarball", () =>
    Effect.gen(function*() {
      const r = yield* _run({ files: ["web-1.0.0.tgz"], digest: _sha(new Uint8Array([9])) })
      expect(_failure(r.exit)).toBeInstanceOf(HelmDigestMismatch)
      expect(r.slotExists).toBe(false)
      expect(r.entries).toEqual([])
    }))

  it.effect.each([{ files: [] }, { files: ["web-1.tgz", "web-2.tgz"] }, { files: ["other-1.tgz"] }])(
    "tarball count other than one fails with HelmRenderError pull (%j)",
    ({ files }) =>
      Effect.gen(function*() {
        const r = yield* _run({ files })
        const err = _failure(r.exit)
        expect(err).toBeInstanceOf(HelmRenderError)
        expect(err).toMatchObject({ phase: "pull" })
        expect(r.entries).toEqual([])
      })
  )
})

const _concurrent = (opts: { readonly files: ReadonlyArray<string>; readonly rounds: number }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cacheDir = path.join(yield* fs.makeTempDirectoryScoped(), "cache")
    const pulls = { count: 0 }
    const input = { repo: "https://r", chart: "web", version: "1.0.0", cacheDir }

    const exits = yield* Effect.forEach(
      Array.from({ length: opts.rounds }, () => ensureChartTarball(input)),
      Effect.exit,
      { concurrency: "unbounded" }
    ).pipe(Effect.provide(_spawner({ files: opts.files, pulls })))

    return { exits, pulls: pulls.count }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe("ensureChartTarball in-flight sharing", () => {
  it.effect("property: N concurrent callers of one slot spawn helm pull once", () =>
    Effect.gen(function*() {
      for (const rounds of [2, 5, 9]) {
        const r = yield* _concurrent({ files: ["web-1.0.0.tgz"], rounds })
        expect(r.exits.every(Exit.isSuccess)).toBe(true)
        expect(r.pulls).toBe(1)
      }
    }))

  it.effect("a failed pull is shared by concurrent callers and retried by the next call", () =>
    Effect.gen(function*() {
      const failed = yield* _concurrent({ files: [], rounds: 3 })
      expect(failed.exits.every(Exit.isFailure)).toBe(true)
      expect(failed.pulls).toBe(1)
      const again = yield* _concurrent({ files: [], rounds: 1 })
      expect(again.pulls).toBe(1)
    }))
})
