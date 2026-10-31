import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import * as Core from "@konfig.ts/core"
import { Effect } from "effect"
import { describe, expect, expectTypeOf } from "vitest"
import * as Barrel from "./index"

const FIXTURES = new URL("../fixtures/", import.meta.url).pathname

const SCHEMAS = [
  "BuildAtom",
  "CopyAtom",
  "DevSpec",
  "DockerSpec",
  "HealthcheckAtom",
  "PackageManagerAtom",
  "PlatformAtom",
  "RunnerSpec",
  "RuntimeAtom",
  "UserAtom",
  "decodeDockerSpec",
  "decodeDockerSpecSync"
]

const PIPELINE = [
  "buildIR",
  "emit",
  "extractHeader",
  "HEADER_MARKER",
  "lower",
  "prepareContext",
  "render",
  "renderFile",
  "renderHeader",
  "sha256Hex",
  "validateSpec"
]

const GRAPH = ["allWorkspaces", "closureOf", "detectPm", "findRoot", "lookupWorkspace", "workspaceDeps"]

const IMPLEMENTATIONS = ["bunPm", "bunRuntime", "nodeRuntime", "npmPm", "pnpmPm"]

const IDENTITY = ["Docker", "DockerAppTypeId", "isDockerApp", "makeDockerApp", "PACKAGE_NAME"]

const ERRORS = [
  "BuildScriptMissing",
  "BunVersionUnsupported",
  "CircularWorkspaceDep",
  "DockerWriteError",
  "DockerWriteRefused",
  "EngineVersionInvalid",
  "EngineVersionMissing",
  "MonorepoRootNotFound",
  "PackageJsonInvalid",
  "PmRuntimeIncompatible",
  "SharedRootFileMissing",
  "SpecDecodeError",
  "SpecInvalid",
  "UnsupportedPm",
  "UnsupportedYarnLinker",
  "WorkspaceConfigInvalid",
  "WorkspaceNotFound",
  "WorkspaceSourceUnknown"
]

const RUNTIME_EXPORTS = [...SCHEMAS, ...PIPELINE, ...GRAPH, ...IMPLEMENTATIONS, ...IDENTITY, ...ERRORS]

const ERROR_INSTANCES: ReadonlyArray<{ readonly _tag: string }> = [
  new Barrel.BuildScriptMissing({ target: "apps/x", script: "build" }),
  new Barrel.BunVersionUnsupported({ target: "apps/x", version: "1.1.38", minimum: "1.2" }),
  new Barrel.CircularWorkspaceDep({ cycle: ["@a", "@b", "@a"] }),
  new Barrel.DockerWriteError({ path: "Dockerfile", cause: "perm" }),
  new Barrel.DockerWriteRefused({ path: "Dockerfile", reason: "no marker" }),
  new Barrel.EngineVersionInvalid({ target: "apps/x", engineField: "engines.node", value: ">=22" }),
  new Barrel.EngineVersionMissing({ target: "apps/x", engineField: "engines.bun" }),
  new Barrel.MonorepoRootNotFound({ from: "/x" }),
  new Barrel.PackageJsonInvalid({ path: "package.json", cause: "bad json" }),
  new Barrel.PmRuntimeIncompatible({ pm: "Bun", runtime: "Node" }),
  new Barrel.SharedRootFileMissing({ target: "apps/x", path: "tsconfig.base.json" }),
  new Barrel.SpecDecodeError({ specPath: "apps/x/docker.ts", cause: "x" }),
  new Barrel.SpecInvalid({ cause: "x" }),
  new Barrel.UnsupportedPm({ reason: "ambiguous", candidates: ["bun", "npm"] }),
  new Barrel.UnsupportedYarnLinker({ linker: "pnp" }),
  new Barrel.WorkspaceConfigInvalid({ path: "pnpm-workspace.yaml", cause: "bad yaml" }),
  new Barrel.WorkspaceNotFound({ target: "@x/y" }),
  new Barrel.WorkspaceSourceUnknown({ target: "apps/x", missingWorkspace: "@y/z" })
]

describe("@konfig.ts/docker barrel", () => {
  it("exports its package name", () => {
    expect(Barrel.PACKAGE_NAME).toBe("@konfig.ts/docker")
  })

  it("exports exactly the documented runtime surface", () => {
    expect(Object.keys(Barrel).sort()).toEqual([...RUNTIME_EXPORTS].sort())
  })

  it("exports every docker error as a tagged error class", () => {
    expect(ERROR_INSTANCES.map((e) => e._tag)).toEqual(ERRORS)
  })

  it("re-exports core's sha256Hex", () => {
    expect(Barrel.sha256Hex).toBe(Core.sha256Hex)
  })

  it("does not restore Docker.platform.multi", () => {
    expect(Object.keys(Barrel.Docker.platform).sort()).toEqual(["linuxAmd64", "linuxArm64"])
  })

  it("names the package in the header marker", () => {
    expect(Barrel.HEADER_MARKER).toBe(`# konfig-managed: ${Barrel.PACKAGE_NAME}`)
  })

  it("exposes the package-manager and runtime implementations", () => {
    expect([Barrel.bunPm.kind, Barrel.npmPm.kind, Barrel.pnpmPm({ layout: "hoisted" }).kind]).toEqual([
      "Bun",
      "Npm",
      "Pnpm"
    ])
    expect([Barrel.bunRuntime.kind, Barrel.nodeRuntime.kind]).toEqual(["Bun", "Node"])
  })

  it("makeDockerApp brands a spec the same way as Docker.app", () => {
    const spec: Barrel.DockerSpec = { runner: { workdir: "/app", copy: [], cmd: ["bun", "x.js"] } }

    expect(Barrel.makeDockerApp(spec)).toEqual(Barrel.Docker.app(spec))
    expect(Barrel.DockerAppTypeId in Barrel.makeDockerApp(spec)).toBe(true)
  })
})

describe("@konfig.ts/docker pipeline exports", () => {
  const spec: Barrel.DockerSpec = { runner: { workdir: "/app/packages/app", copy: [], cmd: ["bun", "x.js"] } }
  const target = `${FIXTURES}bun/packages/app`

  it.effect("lower + render + renderFile reproduce emit byte for byte", () =>
    Effect.gen(function*() {
      const emitted = yield* Barrel.emit({ spec, target, specPath: "docker.ts" })
      const bundle = yield* Barrel.lower({ spec, target })

      expect(Barrel.renderFile({ specPath: "docker.ts", body: Barrel.render(bundle.prod) })).toBe(emitted.dockerfile)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("prepareContext resolves the target workspace and validateSpec accepts the spec", () =>
    Effect.gen(function*() {
      const ctx = yield* Barrel.prepareContext({ spec, target })
      yield* Barrel.validateSpec({ spec, ctx })

      expect(ctx.target.relDir).toBe("packages/app")
      expect(ctx.detectedPm.kind).toBe("Bun")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("detectPm reports the fixture's package manager", () =>
    Effect.gen(function*() {
      const root = yield* Barrel.findRoot(target)

      expect((yield* Barrel.detectPm(root)).kind).toBe("Bun")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("@konfig.ts/docker public types", () => {
  it("exports the IR types", () => {
    expectTypeOf<Barrel.DockerfileBundle["prod"]>().toEqualTypeOf<Barrel.Dockerfile>()
    expectTypeOf<Barrel.Dockerfile["stages"]>().toEqualTypeOf<ReadonlyArray<Barrel.Stage>>()
    expectTypeOf<Barrel.Stage["from"]>().toEqualTypeOf<Barrel.From>()
    expectTypeOf<Barrel.PlatformIR["value"]>().toEqualTypeOf<Barrel.PlatformValue>()
    expectTypeOf<Extract<Barrel.Instruction, { _tag: "Healthcheck" }>["check"]>().toEqualTypeOf<
      Barrel.HealthcheckIR
    >()
  })

  it("exports the package-manager and runtime types", () => {
    expectTypeOf(Barrel.bunPm).toEqualTypeOf<Barrel.PackageManager>()
    expectTypeOf(Barrel.nodeRuntime).toEqualTypeOf<Barrel.Runtime>()
    expectTypeOf<Barrel.PackageManager["nodeModulesLayout"]>().toEqualTypeOf<Barrel.NodeModulesLayout>()
    expectTypeOf<Barrel.PnpmOptions["layout"]>().toEqualTypeOf<Barrel.NodeModulesLayout>()
    expectTypeOf<ReturnType<Barrel.Runtime["imageRef"]>>().toEqualTypeOf<Barrel.ImageRef>()
    expectTypeOf<Parameters<Barrel.Runtime["imageRef"]>[0]>().toEqualTypeOf<Barrel.RuntimeImageInput>()
  })

  it("exports the workspace graph types", () => {
    expectTypeOf<Barrel.Workspace["pkg"]>().toEqualTypeOf<Barrel.PackageJson>()
    expectTypeOf<Barrel.ClosureInput["target"]>().toEqualTypeOf<Barrel.Workspace>()
    expectTypeOf<Barrel.LowerContext["root"]>().toEqualTypeOf<Barrel.RootDir>()
    expectTypeOf<Barrel.LowerContext["detectedPm"]>().toEqualTypeOf<Barrel.DetectedPm>()
  })

  it("exports the pipeline and header types", () => {
    expectTypeOf<Parameters<typeof Barrel.lower>[0]>().toEqualTypeOf<Barrel.LowerInput>()
    expectTypeOf<Parameters<typeof Barrel.buildIR>[0]>().toEqualTypeOf<Barrel.BuildIRInput>()
    expectTypeOf<Barrel.BuildIRInput["ctx"]>().toEqualTypeOf<Barrel.LowerContext>()
    expectTypeOf<Parameters<typeof Barrel.emit>[0]>().toEqualTypeOf<Barrel.EmitInput>()
    expectTypeOf<Effect.Success<ReturnType<typeof Barrel.emit>>>().toEqualTypeOf<Barrel.EmittedDockerfiles>()
    expectTypeOf<Parameters<typeof Barrel.renderFile>[0]>().toEqualTypeOf<Barrel.RenderFileInput>()
    expectTypeOf<Parameters<typeof Barrel.renderHeader>[0]>().toEqualTypeOf<Barrel.RenderHeaderInput>()
    expectTypeOf(Barrel.extractHeader("")).toEqualTypeOf<Barrel.ExtractedHeader>()
  })

  it("exports the identity and error types", () => {
    expectTypeOf<Barrel.DockerApp[Barrel.DockerAppTypeId]>().toEqualTypeOf<true>()
    expectTypeOf<Barrel.DockerApp["spec"]>().toEqualTypeOf<Barrel.DockerSpec>()
    expectTypeOf<Barrel.SpecInvalid>().toExtend<Barrel.AnyDockerError>()
  })
})
