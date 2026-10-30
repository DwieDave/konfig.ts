import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { Command } from "effect/process/ChildProcess"
import { isStandardCommand } from "effect/process/ChildProcess"
import { type ChildProcessHandle, ChildProcessSpawner, make as makeSpawner } from "effect/process/ChildProcessSpawner"
import { isRecord } from "./guards"
import { sha256Hex } from "./hash"
import * as Helm from "./Helm"
import { RenderContext } from "./RenderContext"
import { fakeHandle } from "./testing"

const _isString = Schema.is(Schema.String)

const _handle = (stdout: string): ChildProcessHandle => fakeHandle({ stdout })

const _doc = (kind: string, extra = ""): string => `apiVersion: v1\nkind: ${kind}\nmetadata:\n  name: x\n${extra}`

const _crd = (kind: string, scope: string): string =>
  _doc("CustomResourceDefinition", `spec:\n  scope: ${scope}\n  names:\n    kind: ${kind}\n`)

interface _RenderInput {
  readonly stdout: string
  readonly clusterScopedKinds?: ReadonlyArray<string>
}

const _namespaces = (input: _RenderInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-scope-" })
    const tarball = Buffer.from("scope-tarball")
    const digest = `sha256:${sha256Hex(tarball)}`
    yield* fs.writeFile(path.join(cacheDir, `c-1.0.0-${digest.slice(7, 19)}.tgz`), tarball)

    const spawner = Layer.succeed(
      ChildProcessSpawner,
      makeSpawner((command: Command) =>
        Effect.succeed(
          isStandardCommand(command) && command.args[0] === "template" ? _handle(input.stdout) : _handle("")
        )
      )
    )

    const docs = yield* Helm.release({
      repo: "https://example.com",
      chart: "c",
      version: "1.0.0",
      digest,
      namespace: "ns",
      values: {},
      clusterScopedKinds: input.clusterScopedKinds
    }).render(RenderContext.make("test")).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, spawner)),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ KONFIG_HELM_CACHE: cacheDir })),
      Effect.scoped
    )

    return Object.fromEntries(docs.flatMap((d) => {
      if (!isRecord(d.value) || !_isString(d.value["kind"])) return []
      const meta = isRecord(d.value["metadata"]) ? d.value["metadata"] : {}

      return [[d.value["kind"], meta["namespace"]]]
    }))
  }).pipe(Effect.provide(NodeServices.layer))

describe("Helm.release cluster-scoped kinds", () => {
  it.effect("never injects a namespace into newer built-in cluster-scoped kinds", () =>
    Effect.gen(function*() {
      const kinds = [
        "VolumeAttributesClass",
        "DeviceClass",
        "ServiceCIDR",
        "IPAddress",
        "CertificateSigningRequest",
        "ClusterTrustBundle"
      ]

      const out = yield* _namespaces({ stdout: kinds.map((k) => _doc(k)).join("---\n") })

      for (const k of kinds) expect(out[k]).toBeUndefined()
    }))

  it.effect("treats a custom kind as cluster-scoped when its CRD in the chart says Cluster", () =>
    Effect.gen(function*() {
      const out = yield* _namespaces({
        stdout: [_crd("Widget", "Cluster"), _doc("Widget"), _crd("Gadget", "Namespaced"), _doc("Gadget")].join("---\n")
      })

      expect(out["Widget"]).toBeUndefined()
      expect(out["Gadget"]).toBe("ns")
    }))

  it.effect("honors clusterScopedKinds for CRDs not shipped in the chart", () =>
    Effect.gen(function*() {
      const out = yield* _namespaces({ stdout: [_doc("Foo"), _doc("Bar")].join("---\n"), clusterScopedKinds: ["Foo"] })
      expect(out["Foo"]).toBeUndefined()
      expect(out["Bar"]).toBe("ns")
    }))

  it.effect("stamps the namespace when metadata is null", () =>
    Effect.gen(function*() {
      const out = yield* _namespaces({ stdout: "apiVersion: v1\nkind: Thing\nmetadata:\n" })
      expect(out["Thing"]).toBe("ns")
    }))

  it.effect("stamps the namespace when it is an empty string", () =>
    Effect.gen(function*() {
      const out = yield* _namespaces({ stdout: _doc("Thing", "  namespace: ''\n") })
      expect(out["Thing"]).toBe("ns")
    }))
})
