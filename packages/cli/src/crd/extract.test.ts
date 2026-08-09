import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Exit, Layer, Schema, Sink, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { type Command, isStandardCommand } from "effect/unstable/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import {
  _crdNameToIdentifier,
  _dedupeCrdDocuments,
  _parseCrdDocs,
  CrdInputDecodeError,
  extractCrdsEffect,
  GENERATED_HEADER,
  verifyCrdsEffect
} from "./extract"

const validOpts = {
  repo: "https://charts.bitnami.com/bitnami",
  chart: "postgresql",
  version: "16.0.0",
  id: "postgres",
  outDir: "/tmp/konfig-test-out",
  cacheDir: "/tmp/konfig-test-cache"
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

const _handle = (proc: { stdout?: string; stderr?: string; exitCode?: number }): ChildProcessHandle =>
  makeHandle(
    {
      pid: ProcessId(4242),
      exitCode: Effect.succeed(ExitCode(proc.exitCode ?? 0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: _bytes(proc.stdout ?? ""),
      stderr: _bytes(proc.stderr ?? ""),
      all: _bytes((proc.stdout ?? "") + (proc.stderr ?? "")),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void)
    } as Parameters<typeof makeHandle>[0]
  )

/**
 * Fake `helm` spawner: routes on the subcommand (`pull`/`template`) so a
 * single layer can stand in for the whole extract pipeline — `pull
 * --untar` (into the crds/ scan) always "succeeds" with no output, while
 * `template` returns the caller-supplied CRD YAML fixture.
 */
const _helmSpawner = (templateStdout: string): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command: Command) => {
      const args = isStandardCommand(command) ? command.args : []
      if (args.includes("template")) {
        return Effect.succeed(_handle({ stdout: templateStdout, exitCode: 0 }))
      }
      return Effect.succeed(_handle({ stdout: "", exitCode: 0 }))
    })
  )

const _validCrdYaml = `
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.example.com
spec:
  group: example.com
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                size:
                  type: string
              required:
                - size
`

const _testLayer = (templateStdout: string) => Layer.merge(NodeServices.layer, _helmSpawner(templateStdout))

layer(NodeServices.layer)("extractCrdsEffect input boundary", (it) => {
  it.effect("rejects shell-metachar chart name before any process is spawned", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, chart: "x; touch /tmp/pwned" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause
        const fails = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(failure)
        expect(fails).toContain("CrdInputDecodeError")
      }
    }))

  it.effect("rejects shell-metachar version", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, version: "1.0.0 && rm -rf /" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))

  it.effect("rejects backtick injection in repo", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({
          ...validOpts,
          repo: "https://foo.example.com/`whoami`"
        })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))

  it.effect("rejects non-http(s)/oci repo schemes", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, repo: "file:///etc/passwd" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))

  it.effect("rejects newline injection in chart name", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, chart: "postgresql\nrm -rf /" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))
})

describe("CrdInputDecodeError", () => {
  it("is a tagged error class", () => {
    const err = new CrdInputDecodeError({ cause: "bad" })
    expect(err._tag).toBe("CrdInputDecodeError")
    expect(err.message).toContain("CRD extract inputs rejected by schema")
  })
})

describe("extractCrdsEffect end-to-end", () => {
  it.effect("writes generated TypeScript for a real CRD YAML fixture", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })

      yield* extractCrdsEffect({ ...validOpts, outDir, cacheDir })

      const outPath = path.join(outDir, `${validOpts.id}.ts`)
      const content = yield* fs.readFileString(outPath)
      expect(content.startsWith(GENERATED_HEADER)).toBe(true)
      expect(content).toContain("WidgetsInput")
      expect(content).toContain("CRD: widgets.example.com (group: example.com, versions: v1)")
      expect(content).toContain("size")
    }).pipe(Effect.scoped, Effect.provide(_testLayer(_validCrdYaml))))

  it.effect("writes a stub file when the chart has no CRDs", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })

      yield* extractCrdsEffect({ ...validOpts, outDir, cacheDir })

      const outPath = path.join(outDir, `${validOpts.id}.ts`)
      const content = yield* fs.readFileString(outPath)
      expect(content.startsWith(GENERATED_HEADER)).toBe(true)
      expect(content).toContain("No CRDs found in chart")
      expect(content).toContain("export {};")
    }).pipe(Effect.scoped, Effect.provide(_testLayer(""))))

  it.effect("writes a stub file when helm template stdout is unparseable YAML", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })

      yield* extractCrdsEffect({ ...validOpts, outDir, cacheDir })

      const outPath = path.join(outDir, `${validOpts.id}.ts`)
      const content = yield* fs.readFileString(outPath)
      expect(content).toContain("No CRDs found in chart")
    }).pipe(
      Effect.scoped,
      Effect.provide(_testLayer("not: valid: yaml: [unterminated"))
    ))

  it.effect("wraps a subprocess failure as CrdExtractError carrying the chart name", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })

      const failingSpawner = Layer.succeed(
        ChildProcessSpawner,
        makeSpawner(() => Effect.succeed(_handle({ stderr: "network unreachable", exitCode: 1 })))
      )

      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, outDir, cacheDir }).pipe(
          Effect.provide(failingSpawner)
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("CrdExtractError")
        expect(text).toContain(validOpts.chart)
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("_parseCrdDocs", () => {
  it("parses a well-formed CustomResourceDefinition document", () => {
    const docs = _parseCrdDocs(_validCrdYaml)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.crdName).toBe("widgets.example.com")
    expect(docs[0]?.group).toBe("example.com")
    expect(docs[0]?.versions).toEqual(["v1"])
    expect(docs[0]?.schema).toHaveProperty("properties")
  })

  it("ignores non-CRD documents in a multi-doc stream", () => {
    const docs = _parseCrdDocs(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: not-a-crd
---
${_validCrdYaml}
`)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.crdName).toBe("widgets.example.com")
  })

  it("skips a CRD document missing metadata or spec", () => {
    expect(_parseCrdDocs(`
kind: CustomResourceDefinition
spec:
  group: example.com
  versions: []
`)).toEqual([])
    expect(_parseCrdDocs(`
kind: CustomResourceDefinition
metadata:
  name: foo.example.com
`)).toEqual([])
  })

  it("skips a CRD document with an empty name", () => {
    expect(_parseCrdDocs(`
kind: CustomResourceDefinition
metadata:
  name: ""
spec:
  group: example.com
  versions:
    - name: v1
`)).toEqual([])
  })

  it("skips a CRD document with no versions", () => {
    expect(_parseCrdDocs(`
kind: CustomResourceDefinition
metadata:
  name: foo.example.com
spec:
  group: example.com
  versions: []
`)).toEqual([])
  })

  it("falls back to a permissive schema when no version carries openAPIV3Schema", () => {
    const docs = _parseCrdDocs(`
kind: CustomResourceDefinition
metadata:
  name: foo.example.com
spec:
  group: example.com
  versions:
    - name: v1
    - name: v2
`)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.schema).toEqual({ type: "object", additionalProperties: true })
    expect(docs[0]?.versions).toEqual(["v1", "v2"])
  })

  it("returns no documents for unparseable YAML instead of throwing", () => {
    expect(() => _parseCrdDocs("not: valid: yaml: [unterminated")).not.toThrow()
    expect(_parseCrdDocs("not: valid: yaml: [unterminated")).toEqual([])
  })

  it("returns no documents for an empty string", () => {
    expect(_parseCrdDocs("")).toEqual([])
  })
})

describe("_crdNameToIdentifier", () => {
  it("takes the resource segment before the first dot and PascalCases it", () => {
    expect(_crdNameToIdentifier("widgets.example.com")).toBe("Widgets")
  })

  it("joins hyphen/underscore-separated words in PascalCase", () => {
    expect(_crdNameToIdentifier("cron-tab-jobs.example.com")).toBe("CronTabJobs")
    expect(_crdNameToIdentifier("cron_tab_jobs.example.com")).toBe("CronTabJobs")
  })

  it("falls back to the raw name when there is no dot", () => {
    expect(_crdNameToIdentifier("widgets")).toBe("Widgets")
  })
})

describe("_dedupeCrdDocuments", () => {
  it("keeps the first document seen for a duplicate CRD name across YAML sources", () => {
    const first = `
kind: CustomResourceDefinition
metadata:
  name: foo.example.com
spec:
  group: first.example.com
  versions:
    - name: v1
`
    const second = `
kind: CustomResourceDefinition
metadata:
  name: foo.example.com
spec:
  group: second.example.com
  versions:
    - name: v2
`
    const deduped = _dedupeCrdDocuments([first, second])
    expect(deduped.size).toBe(1)
    expect(deduped.get("foo.example.com")?.group).toBe("first.example.com")
  })

  it("collects distinct CRDs from multiple YAML sources", () => {
    const deduped = _dedupeCrdDocuments([
      _validCrdYaml,
      `
kind: CustomResourceDefinition
metadata:
  name: gadgets.example.com
spec:
  group: example.com
  versions:
    - name: v1
`
    ])
    expect([...deduped.keys()].sort()).toEqual(["gadgets.example.com", "widgets.example.com"])
  })
})

describe("verifyCrdsEffect", () => {
  it.effect("reports no drift when the committed file matches a fresh extraction", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const committedDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-committed-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })

      yield* extractCrdsEffect({ ...validOpts, outDir: committedDir, cacheDir }).pipe(
        Effect.provide(_helmSpawner(_validCrdYaml))
      )

      const drifted = yield* verifyCrdsEffect({
        releases: [{ ...validOpts, outDir: committedDir, cacheDir }],
        committedDir
      }).pipe(Effect.provide(_helmSpawner(_validCrdYaml)))

      expect(drifted).toEqual([])
      const committed = yield* fs.readFileString(path.join(committedDir, `${validOpts.id}.ts`))
      expect(committed.startsWith(GENERATED_HEADER)).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("reports drift when the committed file is stale", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const committedDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-committed-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })

      yield* fs.writeFileString(
        path.join(committedDir, `${validOpts.id}.ts`),
        `${GENERATED_HEADER}\n// stale content\nexport {};\n`
      )

      const drifted = yield* verifyCrdsEffect({
        releases: [{ ...validOpts, outDir: committedDir, cacheDir }],
        committedDir
      }).pipe(Effect.provide(_helmSpawner(_validCrdYaml)))

      expect(drifted).toEqual([`${validOpts.id}.ts`])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("reports drift when the committed file is missing the generated header", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const committedDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-committed-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })

      yield* fs.writeFileString(path.join(committedDir, `${validOpts.id}.ts`), "// hand-edited, no header\n")

      const drifted = yield* verifyCrdsEffect({
        releases: [{ ...validOpts, outDir: committedDir, cacheDir }],
        committedDir
      }).pipe(Effect.provide(_helmSpawner(_validCrdYaml)))

      expect(drifted).toEqual([`${validOpts.id}.ts (missing generated header)`])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("returns an empty drift list for an empty release set", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const committedDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-committed-" })
      const drifted = yield* verifyCrdsEffect({ releases: [], committedDir })
      expect(drifted).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
