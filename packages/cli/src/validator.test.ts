import { Cause, Effect, Exit, Layer, Option, Sink, Stream } from "effect"
import * as PlatformError from "effect/PlatformError"
import type { Command } from "effect/unstable/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import { describe, expect, it } from "vitest"
import { KubeconformNotFound, KubeconformReportError, runKubeconform, validateManifestFile } from "./validator"

interface FakeProc {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

const _spawnerFor = (proc: FakeProc): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((_command: Command) =>
      Effect.succeed(
        makeHandle({
          pid: ProcessId(1),
          exitCode: Effect.succeed(ExitCode(proc.exitCode ?? 0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: _bytes(proc.stdout ?? ""),
          stderr: _bytes(proc.stderr ?? ""),
          all: _bytes(""),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void)
        }) as ChildProcessHandle
      )
    )
  )

const _spawnFails = (): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((_command: Command) =>
      Effect.fail(
        PlatformError.badArgument({
          module: "ChildProcess",
          method: "spawn",
          description: "spawn kubeconform ENOENT"
        })
      )
    )
  )

describe("validateManifestFile", () => {
  it("accepts a valid single-document manifest", async () => {
    const content = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: prod
spec: {}
`
    const issues = await Effect.runPromise(
      validateManifestFile({ file: "Deployment-api.yaml", content })
    )
    expect(issues).toEqual([])
  })

  it("flags a missing kind", async () => {
    const content = `apiVersion: apps/v1
metadata:
  name: api
`
    const issues = await Effect.runPromise(
      validateManifestFile({ file: "x.yaml", content })
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain("envelope")
  })

  it("flags a misspelled metadata.name (uppercase)", async () => {
    const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: NotADnsLabel
`
    const issues = await Effect.runPromise(
      validateManifestFile({ file: "x.yaml", content })
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain("envelope")
  })

  it("walks multi-doc YAML with per-doc indexing", async () => {
    const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
---
apiVersion: v1
kind: Service
metadata:
  name: SVC
`
    const issues = await Effect.runPromise(
      validateManifestFile({ file: "multi.yaml", content })
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.doc).toBe(1)
  })

  it("does not mis-split a document whose block scalar contains a literal ---", async () => {
    // A naive /^---$/m split would break this single ConfigMap into three
    // fragments; parseYamlAll keeps the block scalar intact as one doc.
    const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  note: |
    line one
    ---
    line three
`
    const issues = await Effect.runPromise(
      validateManifestFile({ file: "cm.yaml", content })
    )
    expect(issues).toEqual([])
  })

  it("accepts a manifest without namespace (cluster-scoped)", async () => {
    const content = `apiVersion: v1
kind: Namespace
metadata:
  name: app
`
    const issues = await Effect.runPromise(
      validateManifestFile({ file: "ns.yaml", content })
    )
    expect(issues).toEqual([])
  })
})

describe("runKubeconform", () => {
  it("returns stdout on a zero exit even when stdout mentions the word Invalid", async () => {
    const summary = "Summary: 3 resources found parsing, 0 Invalid, 0 Errors"
    const out = await Effect.runPromise(
      runKubeconform({ dir: "/rendered" }).pipe(
        Effect.provide(_spawnerFor({ stdout: summary, exitCode: 0 }))
      )
    )
    expect(out).toBe(summary)
  })

  it("a non-zero exit fails with KubeconformReportError carrying stdout AND stderr", async () => {
    const exit = await Effect.runPromiseExit(
      runKubeconform({ dir: "/rendered" }).pipe(
        Effect.provide(
          _spawnerFor({
            stdout: "deployment.apps invalid: missing required field",
            stderr: "warning: could not resolve schema",
            exitCode: 1
          })
        )
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
      expect(err).toBeInstanceOf(KubeconformReportError)
      if (err instanceof KubeconformReportError) {
        expect(err.stdout).toContain("missing required field")
        expect(err.stderr).toContain("could not resolve schema")
      }
    }
  })

  it("a spawn failure (binary missing) fails with KubeconformNotFound", async () => {
    const exit = await Effect.runPromiseExit(
      runKubeconform({ dir: "/rendered" }).pipe(Effect.provide(_spawnFails()))
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toBeInstanceOf(KubeconformNotFound)
    }
  })
})
