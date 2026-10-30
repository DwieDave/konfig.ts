import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Sink, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { Command } from "effect/process/ChildProcess"
import { isStandardCommand } from "effect/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/process/ChildProcessSpawner"
import * as crypto from "node:crypto"
import { isRecord } from "./guards"
import * as Helm from "./Helm"
import { RenderContext } from "./RenderContext"

const _handle = (stdout: string): ChildProcessHandle =>
  makeHandle(
    {
      pid: ProcessId(1),
      exitCode: Effect.succeed(ExitCode(0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: Stream.make(new TextEncoder().encode(stdout)),
      stderr: Stream.empty,
      all: Stream.make(new TextEncoder().encode(stdout)),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void)
    } as Parameters<typeof makeHandle>[0]
  )

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
    const digest = `sha256:${crypto.createHash("sha256").update(tarball).digest("hex")}`
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
      if (!isRecord(d.value) || typeof d.value["kind"] !== "string") return []
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
})
