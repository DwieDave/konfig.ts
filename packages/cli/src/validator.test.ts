import { describe, expect, it } from "@effect/vitest"
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

// Captures the args each spawned `Command` carried, so tests can assert on
// what `runKubeconform` actually forwards (e.g. `-kubernetes-version`).
const _spawnerCapturing = (
  proc: FakeProc,
  captured: { args: ReadonlyArray<string> | undefined }
): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command: Command) => {
      captured.args = command._tag === "StandardCommand" ? command.args : []
      return Effect.succeed(
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
    })
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
  it.effect("accepts a valid single-document manifest", () =>
    Effect.gen(function*() {
      const content = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: prod
spec: {}
`
      const issues = yield* validateManifestFile({ file: "Deployment-api.yaml", content })
      expect(issues).toEqual([])
    }))

  it.effect("flags a missing kind", () =>
    Effect.gen(function*() {
      const content = `apiVersion: apps/v1
metadata:
  name: api
`
      const issues = yield* validateManifestFile({ file: "x.yaml", content })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("envelope")
    }))

  it.effect("flags a misspelled metadata.name (uppercase)", () =>
    Effect.gen(function*() {
      const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: NotADnsLabel
`
      const issues = yield* validateManifestFile({ file: "x.yaml", content })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("metadata.name")
    }))

  it.effect("walks multi-doc YAML with per-doc indexing", () =>
    Effect.gen(function*() {
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
      const issues = yield* validateManifestFile({ file: "multi.yaml", content })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.doc).toBe(1)
    }))

  it.effect("does not mis-split a document whose block scalar contains a literal ---", () =>
    Effect.gen(function*() {
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
      const issues = yield* validateManifestFile({ file: "cm.yaml", content })
      expect(issues).toEqual([])
    }))

  it.effect("accepts a manifest without namespace (cluster-scoped)", () =>
    Effect.gen(function*() {
      const content = `apiVersion: v1
kind: Namespace
metadata:
  name: app
`
      const issues = yield* validateManifestFile({ file: "ns.yaml", content })
      expect(issues).toEqual([])
    }))

  it.effect("accepts a dotted metadata.name on a CustomResourceDefinition (DNS-1123 subdomain, not a label)", () =>
    Effect.gen(function*() {
      const content = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: sopssecrets.isindir.github.com
`
      const issues = yield* validateManifestFile({ file: "crd.yaml", content })
      expect(issues).toEqual([])
    }))

  it.effect("flags an uppercase, underscore-containing metadata.name as an invalid DNS-1123 subdomain", () =>
    Effect.gen(function*() {
      const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: Invalid_Name
`
      const issues = yield* validateManifestFile({ file: "cm.yaml", content })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("metadata.name")
      expect(issues[0]?.message).toContain("RFC 1123 subdomain")
    }))

  it.effect("rejects a dotted Service name — Service requires the stricter RFC 1123 label rule", () =>
    Effect.gen(function*() {
      const content = `apiVersion: v1
kind: Service
metadata:
  name: my.service
`
      const issues = yield* validateManifestFile({ file: "svc.yaml", content })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("metadata.name")
      expect(issues[0]?.message).toContain("RFC 1123 label")
    }))

  it.effect("rejects a dotted metadata.namespace — namespaces always use the RFC 1123 label rule", () =>
    Effect.gen(function*() {
      const content = `apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
  namespace: my.app
`
      const issues = yield* validateManifestFile({ file: "cm.yaml", content })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.message).toContain("metadata.namespace")
      expect(issues[0]?.message).toContain("RFC 1123 label")
    }))
})

describe("runKubeconform", () => {
  it.effect("returns stdout on a zero exit even when stdout mentions the word Invalid", () =>
    Effect.gen(function*() {
      const summary = "Summary: 3 resources found parsing, 0 Invalid, 0 Errors"
      const out = yield* runKubeconform({ dir: "/rendered" }).pipe(
        Effect.provide(_spawnerFor({ stdout: summary, exitCode: 0 }))
      )
      expect(out).toBe(summary)
    }))

  it.effect("a non-zero exit fails with KubeconformReportError carrying stdout AND stderr", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
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
    }))

  it.effect("forwards extraArgs, appending -kubernetes-version after the built-in flags", () =>
    Effect.gen(function*() {
      const captured: { args: ReadonlyArray<string> | undefined } = { args: undefined }
      yield* runKubeconform({
        dir: "/rendered",
        extraArgs: ["-ignore-missing-schemas", "-kubernetes-version", "1.29.0"]
      }).pipe(
        Effect.provide(_spawnerCapturing({ exitCode: 0 }, captured))
      )
      expect(captured.args).toEqual([
        "-summary",
        "-strict",
        "/rendered",
        "-ignore-missing-schemas",
        "-kubernetes-version",
        "1.29.0"
      ])
    }))

  it.effect("a spawn failure (binary missing) fails with KubeconformNotFound", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        runKubeconform({ dir: "/rendered" }).pipe(Effect.provide(_spawnFails()))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toBeInstanceOf(KubeconformNotFound)
      }
    }))
})
