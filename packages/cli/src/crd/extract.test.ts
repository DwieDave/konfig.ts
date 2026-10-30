import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { Helm } from "@konfig.ts/core"
import { Effect, Exit, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { type Command, isStandardCommand } from "effect/process/ChildProcess"
import { ChildProcessSpawner, make as makeSpawner } from "effect/process/ChildProcessSpawner"
import fc from "fast-check"
import * as crypto from "node:crypto"
import { fakeHandle, plainArgs } from "../fakeProcess.testing"
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

const _sha256Hex = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex")

interface _Call {
  readonly args: ReadonlyArray<string>
}

/**
 * Fake `helm` spawner: `pull` writes `tarball`'s bytes to
 * `<--destination>/<tarballName>` (default `<chart>-<version>.tgz`, matching
 * real `helm pull` output) and `template` returns the CRD YAML fixture.
 * Every invocation is recorded in `calls`.
 */
const _pullingHelmSpawner = (
  tarball: Buffer,
  templateStdout: string,
  options: { readonly tarballName?: string; readonly calls?: Array<_Call> } = {}
): Layer.Layer<ChildProcessSpawner, never, FileSystem | Path> =>
  Layer.effect(
    ChildProcessSpawner,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path

      return makeSpawner((command: Command) =>
        Effect.gen(function*() {
          const args = isStandardCommand(command) ? plainArgs(command) : []
          options.calls?.push({ args })

          if (args.includes("template")) return fakeHandle({ stdout: templateStdout, exitCode: 0 })

          if (args[0] === "pull") {
            const dest = args[args.indexOf("--destination") + 1] ?? ""
            const chart = args[3] ?? "chart"
            const version = args[args.indexOf("--version") + 1] ?? "0.0.0"
            yield* fs.writeFile(path.join(dest, options.tarballName ?? `${chart}-${version}.tgz`), tarball)
          }

          return fakeHandle({ stdout: "", exitCode: 0 })
        })
      )
    })
  )

const _helmSpawner = (templateStdout: string) => _pullingHelmSpawner(Buffer.from("fake-tarball"), templateStdout)

const _testLayer = (templateStdout: string) => Layer.provideMerge(_helmSpawner(templateStdout), NodeServices.layer)

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

  it.effect("with a digest, caches the pulled tarball under Helm.cacheFileName's digest-suffixed slot", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })
      const tarball = Buffer.from("fake-postgresql-tarball")
      const digest = `sha256:${_sha256Hex(tarball)}`

      yield* extractCrdsEffect({ ...validOpts, outDir, cacheDir, digest }).pipe(
        Effect.provide(_pullingHelmSpawner(tarball, _validCrdYaml))
      )

      // Only the digest-suffixed slot `Helm.release`/`konfig helm fetch` also
      // use — no plain-named tarball and no leftover pull scratch dir.
      const files = yield* fs.readDirectory(cacheDir)
      expect(files).toEqual([
        Helm.cacheFileName({ chart: validOpts.chart, version: validOpts.version, digest })
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("with a digest, fails with HelmDigestMismatch and leaves the cache slot empty when the bytes differ", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })
      const tarball = Buffer.from("real-tarball-bytes")
      const wrongDigest = `sha256:${_sha256Hex(Buffer.from("not-the-tarball"))}`

      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, outDir, cacheDir, digest: wrongDigest }).pipe(
          Effect.provide(_pullingHelmSpawner(tarball, _validCrdYaml))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const fails = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(fails).toContain("HelmDigestMismatch")
      }

      expect(yield* fs.readDirectory(cacheDir)).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("never runs helm pull --untar and accepts a tarball named after a different version string", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crd-cache-" })
      const calls: Array<_Call> = []

      yield* extractCrdsEffect({ ...validOpts, version: "v16.0.0", outDir, cacheDir }).pipe(
        Effect.provide(
          _pullingHelmSpawner(Buffer.from("t"), _validCrdYaml, { tarballName: "postgresql-16.0.0.tgz", calls })
        )
      )

      expect(calls.some((c) => c.args.includes("--untar"))).toBe(false)
      expect(calls.filter((c) => c.args[0] === "pull")).toHaveLength(1)
      expect(yield* fs.readDirectory(cacheDir)).toEqual(["postgresql-v16.0.0.tgz"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

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
        makeSpawner(() => Effect.succeed(fakeHandle({ stderr: "network unreachable", exitCode: 1 })))
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
  const parse = (text: string) => Effect.runSync(_parseCrdDocs(text))
  it("parses a well-formed CustomResourceDefinition document", () => {
    const docs = parse(_validCrdYaml)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.crdName).toBe("widgets.example.com")
    expect(docs[0]?.group).toBe("example.com")
    expect(docs[0]?.versions).toEqual(["v1"])
    expect(docs[0]?.schema).toHaveProperty("properties")
  })

  it("ignores non-CRD documents in a multi-doc stream", () => {
    const docs = parse(`
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
    expect(parse(`
kind: CustomResourceDefinition
spec:
  group: example.com
  versions: []
`)).toEqual([])
    expect(parse(`
kind: CustomResourceDefinition
metadata:
  name: foo.example.com
`)).toEqual([])
  })

  it("skips a CRD document with an empty name", () => {
    expect(parse(`
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
    expect(parse(`
kind: CustomResourceDefinition
metadata:
  name: foo.example.com
spec:
  group: example.com
  versions: []
`)).toEqual([])
  })

  it("falls back to a permissive schema when no version carries openAPIV3Schema", () => {
    const docs = parse(`
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
    expect(parse("not: valid: yaml: [unterminated")).toEqual([])
  })

  it("returns no documents for an empty string", () => {
    expect(parse("")).toEqual([])
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
  const dedupe = (allYaml: readonly string[]) => Effect.runSync(_dedupeCrdDocuments(allYaml))
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

    const deduped = dedupe([first, second])
    expect(deduped.size).toBe(1)
    expect(deduped.get("foo.example.com")?.group).toBe("first.example.com")
  })

  it("collects distinct CRDs from multiple YAML sources", () => {
    const deduped = dedupe([
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

describe("_crdNameToIdentifier properties", () => {
  const _word = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/)

  it("property: output is PascalCase of the resource segment with separators removed", () => {
    fc.assert(
      fc.property(
        fc.array(_word, { minLength: 1, maxLength: 4 }),
        fc.constantFrom("-", "_"),
        fc.array(_word, { maxLength: 3 }),
        (words, sep, groupParts) => {
          const crdName = [words.join(sep), ...groupParts].join(".")
          const id = _crdNameToIdentifier(crdName)
          expect(id).toBe(words.map((w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}`).join(""))
          expect(id).toMatch(/^[A-Z][A-Za-z0-9]*$/)
        }
      )
    )
  })

  it("property: only the first dot-separated segment influences the identifier", () => {
    fc.assert(
      fc.property(_word, fc.array(_word, { maxLength: 3 }), fc.array(_word, { maxLength: 3 }), (resource, a, b) => {
        expect(_crdNameToIdentifier([resource, ...a].join("."))).toBe(_crdNameToIdentifier([resource, ...b].join(".")))
      })
    )
  })
})
