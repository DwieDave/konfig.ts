import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import * as PlatformError from "effect/PlatformError"
import { type Command, isStandardCommand } from "effect/process/ChildProcess"
import { ChildProcessSpawner, make as makeSpawner } from "effect/process/ChildProcessSpawner"
import fc from "fast-check"
import { fakeHandle, type FakeProc, plainArgs } from "./fakeProcess.testing"
import {
  _checkDnsName,
  KubeconformNotFound,
  KubeconformReportError,
  runKubeconform,
  validateManifestFile
} from "./validator"

interface _CapturedArgs {
  args: ReadonlyArray<string> | undefined
}

const _spawnerFor = (proc: FakeProc): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((_command: Command) =>
      Effect.succeed(
        fakeHandle(proc)
      )
    )
  )

// Captures the args each spawned `Command` carried, so tests can assert on
// what `runKubeconform` actually forwards (e.g. `-kubernetes-version`).
const _spawnerCapturing = (
  proc: FakeProc,
  captured: _CapturedArgs
): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command: Command) => {
      captured.args = isStandardCommand(command) ? plainArgs(command) : []

      return Effect.succeed(
        fakeHandle(proc)
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

  it.effect("reports unparseable YAML as a single doc-0 issue", () =>
    Effect.gen(function*() {
      // an unresolved alias is one of the few inputs parseYamlAll actually throws on
      const content = "apiVersion: v1\nkind: *missing\n"
      const issues = yield* validateManifestFile({ file: "broken.yaml", content })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.doc).toBe(0)
      expect(issues[0]?.message).toContain("YAML parse error")
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
          expect(err.message).toContain("kubeconform reported errors")
        }
      }
    }))

  it.effect("forwards extraArgs, placing every flag before the directory", () =>
    Effect.gen(function*() {
      const captured: _CapturedArgs = { args: undefined }
      yield* runKubeconform({
        dir: "/rendered",
        extraArgs: ["-ignore-missing-schemas", "-kubernetes-version", "1.29.0"]
      }).pipe(
        Effect.provide(_spawnerCapturing({ exitCode: 0 }, captured))
      )
      expect(captured.args).toEqual([
        "-summary",
        "-strict",
        "-ignore-missing-schemas",
        "-kubernetes-version",
        "1.29.0",
        "/rendered"
      ])
    }))

  it.effect("a spawn failure (binary missing) fails with KubeconformNotFound", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        runKubeconform({ dir: "/rendered" }).pipe(Effect.provide(_spawnFails()))
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        expect(err).toBeInstanceOf(KubeconformNotFound)

        if (err instanceof KubeconformNotFound) {
          expect(err.message).toContain("kubeconform binary not found")
        }
      }
    }))
})

const _alnum = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split(""))

const _labelOf = (maxLength: number) =>
  fc.tuple(
    _alnum,
    fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")), {
      maxLength: Math.max(0, maxLength - 2)
    }),
    _alnum
  ).map(([head, middle, tail]) => `${head}${middle.join("")}${tail}`)

describe("_checkDnsName properties", () => {
  it("property: every generated RFC 1123 label is accepted under both rules", () => {
    fc.assert(
      fc.property(_labelOf(63), (value) => {
        expect(_checkDnsName({ value, rule: "label" })).toBeUndefined()
        expect(_checkDnsName({ value, rule: "subdomain" })).toBeUndefined()
      })
    )
  })

  it("property: dotted names are subdomains but never labels", () => {
    fc.assert(
      fc.property(fc.array(_labelOf(10), { minLength: 2, maxLength: 5 }), (labels) => {
        const value = labels.join(".")
        expect(_checkDnsName({ value, rule: "subdomain" })).toBeUndefined()
        expect(_checkDnsName({ value, rule: "label" })).toBeDefined()
      })
    )
  })

  it("property: a label longer than 63 chars is rejected as a label", () => {
    fc.assert(
      fc.property(_labelOf(63), (base) => {
        const value = `${base}${"a".repeat(64)}`
        expect(_checkDnsName({ value, rule: "label" })).toBeDefined()
      })
    )
  })

  it("property: any uppercase letter or underscore makes a name invalid", () => {
    fc.assert(
      fc.property(_labelOf(20), fc.constantFrom("A", "Z", "_"), (base, bad) => {
        expect(_checkDnsName({ value: `${base}${bad}${base}`, rule: "subdomain" })).toBeDefined()
      })
    )
  })

  it("the empty string is always invalid", () => {
    expect(_checkDnsName({ value: "", rule: "label" })).toBeDefined()
    expect(_checkDnsName({ value: "", rule: "subdomain" })).toBeDefined()
  })
})
