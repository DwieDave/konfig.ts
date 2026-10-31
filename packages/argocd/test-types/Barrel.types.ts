import type { Dep } from "@konfig.ts/core"
import type { Context, Layer } from "effect"
import type {
  Application,
  AppOfApps,
  AppOfAppsDefaults,
  AppOfAppsResult,
  AppOfAppsTarget,
  ArgoSource,
  HookPhase,
  SyncPolicy
} from "../src/index"

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type _ArgoSource = Expect<Equal<ArgoSource, Application.ArgoSource>>

type _SyncPolicy = Expect<Equal<SyncPolicy, Application.SyncPolicy>>

type _Target = Expect<Equal<AppOfAppsTarget, AppOfApps.AppOfAppsTarget>>

type _Defaults = Expect<Equal<AppOfAppsDefaults, AppOfApps.AppOfAppsDefaults>>

type _Result = Expect<Equal<AppOfAppsResult, AppOfApps.AppOfAppsResult>>

type _HookPhase = Expect<Equal<HookPhase, "PreSync" | "Sync" | "PostSync" | "SyncFail" | "PostDelete">>

type _AppAny = Expect<Equal<Application.Any, Application.Application>>

type _MakeOptions = Expect<Equal<Parameters<typeof Application.make>[0], Application.ApplicationMakeOptions>>

type _AoaMakeOptions = Expect<Equal<Parameters<typeof AppOfApps.make>[0], AppOfApps.AppOfAppsMakeOptions>>

type _HandleIsService = Expect<
  Application.ApplicationHandle<"a", never, never> extends
    Context.Service<Dep.Need<"App", "a">, Application.Application> ? true
    : false
>

type _HandleKind = Expect<Application.HandleKind extends { readonly Handle: unknown } ? true : false>

type _DefineOptions = Expect<
  Application.ApplicationDefineOptions<"a", "ns", never, never> extends
    Application.ExtraCallArgs & Application.ExtraConfig ? true
    : false
>

type _ModuleConfigProvides = Expect<
  Equal<
    Application.ModuleConfig<"ns", object, never, string>["provides"],
    Layer.Layer<string> | undefined
  >
>

type _FromModulesOptions = Expect<
  Equal<AppOfApps.FromModulesOptions<readonly [], never>["target"], AppOfAppsTarget>
>

const _target040: AppOfAppsTarget = { repoURL: "x", branch: "main", rootPath: "p", controllerNamespace: "argocd" }

const _hook: HookPhase = "PreSync"

// @ts-expect-error unknown hook phase
const _badHook: HookPhase = "Later"

void _target040

void _hook

void _badHook

export type _Tests = readonly [
  _ArgoSource,
  _SyncPolicy,
  _Target,
  _Defaults,
  _Result,
  _HookPhase,
  _AppAny,
  _MakeOptions,
  _AoaMakeOptions,
  _HandleIsService,
  _HandleKind,
  _DefineOptions,
  _ModuleConfigProvides,
  _FromModulesOptions
]
