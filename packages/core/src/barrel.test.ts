import { describe, expect, expectTypeOf, it } from "vitest"
import * as Core from "./index"
import type {
  BundleHandle,
  DiffResult,
  DocDiff,
  EmbedYamlSource,
  FileDiff,
  ParsedDoc,
  ProcessFailure,
  ProcessOptions,
  PvcRef,
  PvcRefName,
  RedactOptions,
  RenderAllYamlEffectInput,
  RenderAllYamlInput,
  RenderOptions,
  RunProcessStringOptions,
  ServiceAccountRef
} from "./index"

const RESTORED_0_4_0 = [
  "render",
  "makeStrictDecoder",
  "decodeKonfigConfigSync",
  "decodeKonfigConfigEffect",
  "ClusterSpec",
  "CrdConfig",
  "DiffConfig",
  "EnvEntry",
  "HelmConfig",
  "OutDir",
  "ServicesConfig",
  "parseYaml",
  "deepEqual",
  "redact",
  "redactedEqual",
  "lookupEnv",
  "lookupEnvEffect",
  "requireImageEffect",
  "EnvImages",
  "DEFAULT_HELM_TIMEOUT_SECONDS",
  "DEFAULT_HELM_VERSION_TIMEOUT_SECONDS",
  "KONFIG_HELM_TIMEOUT_ENV",
  "HelmRenderError",
  "HelmVersionTooLow",
  "HelmDigestMismatch",
  "EmbedYamlReadError",
  "ProcessError",
  "ProcessTimeout",
  "processDetail"
]

const NAMESPACE_MEMBERS: ReadonlyArray<readonly [string, object, ReadonlyArray<string>]> = [
  ["Manifest", Core.Manifest, ["combine", "whenever", "ManifestTypeId"]],
  ["Bundle", Core.Bundle, ["make", "makeSet"]],
  ["Dep", Core.Dep, ["ConfigMap", "Pvc", "ServiceAccount", "provideConfigMap", "providePvc", "provideServiceAccount"]],
  ["Compose", Core.Compose, ["composeLayers", "makeResidualEntrypoint"]],
  ["Module", Core.Module, ["asLiteralName"]],
  ["Helm", Core.Helm, ["verifyChartDigest", "versionTimeout"]]
]

describe("core barrel", () => {
  it("exposes RENDER_CONCURRENCY on Manifest and flattenDocs", () => {
    expect(Core.Manifest.RENDER_CONCURRENCY).toBe(4)
    expect("flattenDocs" in Core).toBe(true)
  })

  it.each(RESTORED_0_4_0)("exports the 0.4.0 runtime export %s", (name) => {
    expect(name in Core).toBe(true)
  })

  it.each(NAMESPACE_MEMBERS)("%s carries its 0.4.0 members", (_name, ns, members) => {
    expect(members.filter((member) => !(member in ns))).toEqual([])
  })

  it("does not restore the deprecated Bundle.entrypoint wrapper", () => {
    expect("entrypoint" in Core.Bundle).toBe(false)
  })

  it.each(["ProcessInvocationError", "helmCacheDirConfig", "unwrapDocs", "isRawYaml", "isParsedDoc"])(
    "does not export %s",
    (name) => {
      expect(name in Core).toBe(false)
    }
  )

  it.each(["existsOrFalse", "readOrEmpty", "findUp", "orElseIfNotFound", "strictParseOptions", "sha256Hex"])(
    "exports %s",
    (name) => {
      expect(name in Core).toBe(true)
    }
  )

  it("exports the 0.4.0 public types", () => {
    expectTypeOf<PvcRefName<PvcRef<"data">>>().toEqualTypeOf<"data">()
    expectTypeOf<ServiceAccountRef<"api">>().toEqualTypeOf<Core.Dep.ServiceAccountRef<"api">>()
    expectTypeOf<BundleHandle<"a", never, never>>().toHaveProperty("layer")
    expectTypeOf<DiffResult["entries"][number]>().toEqualTypeOf<FileDiff>()
    expectTypeOf<DocDiff["_tag"]>().toEqualTypeOf<"Same" | "MissingLeft" | "MissingRight" | "Changed">()
    expectTypeOf<EmbedYamlSource>().toEqualTypeOf<Core.Manifest.EmbedYamlSource>()
    expectTypeOf<ParsedDoc>().toEqualTypeOf<Core.Manifest.ParsedDoc>()
    expectTypeOf<ProcessFailure>().toEqualTypeOf<Core.ProcessError | Core.ProcessTimeout>()
    expectTypeOf<RunProcessStringOptions>().toMatchTypeOf<ProcessOptions>()
    expectTypeOf<RedactOptions>().toEqualTypeOf<{ readonly normalizeNumerics?: boolean }>()
    expectTypeOf<RenderAllYamlInput>().toHaveProperty("manifests")
    expectTypeOf<RenderAllYamlEffectInput>().toHaveProperty("manifests")
    expectTypeOf<RenderOptions>().toHaveProperty("runMain")
  })

  it("exports the 0.4.0 namespace types", () => {
    expectTypeOf<Core.Manifest.ManifestTypeId>().toEqualTypeOf<typeof Core.Manifest.ManifestTypeId>()
    expectTypeOf<Core.Manifest.CombineInput<1, 2>>().toHaveProperty("b")
    expectTypeOf<Core.Manifest.WheneverInput<1>>().toHaveProperty("thunk")
    expectTypeOf<Core.Manifest.MakeRun<1>>().toBeFunction()
    expectTypeOf<Core.Manifest.RawYaml>().toHaveProperty("content")
    expectTypeOf<Core.Bundle.BundleMakeOptions>().toHaveProperty("manifests")
    expectTypeOf<Core.Bundle.BundleSetMakeOptions>().toHaveProperty("bundles")
    expectTypeOf<Core.Bundle.LiteralName<"a">>().toEqualTypeOf<"a">()
    expectTypeOf<Core.Bundle.BundleDefineOptions<"a", "ns", never, never>>().toHaveProperty("build")
    expectTypeOf<Core.Bundle.FromModulesOptions<[]>>().toHaveProperty("modules")
    expectTypeOf<Core.Bundle.HandleKind>().toHaveProperty("Handle")
    expectTypeOf<Core.Bundle.ResidualIn<[]>>().toBeNever()
    expectTypeOf<Core.Compose.ComposeHandle>().toHaveProperty("layer")
    expectTypeOf<Core.Compose.DuplicateProvides<[]>>().toBeNever()
    expectTypeOf<Core.Compose.ComposeLayersInput>().toHaveProperty("modules")
    expectTypeOf<Core.Helm.HelmReleaseOptions>().toHaveProperty("digest")
    expectTypeOf<Core.Helm.CacheFileNameInput>().toHaveProperty("chart")
    expectTypeOf<Core.Helm.VerifyChartDigestInput>().toHaveProperty("cachedTgz")
    expectTypeOf<Core.Dep.PvcRefName<Core.PvcRef<"x">>>().toEqualTypeOf<"x">()
  })
})
