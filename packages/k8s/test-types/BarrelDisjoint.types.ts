import { Environment as EnvironmentContract, runtime, Secret as SecretContract } from "@konfig.ts/env"
import { bindEnvironment } from "../src/environmentBind"
import { Secret as SecretIdentity } from "../src/identity"
import { bindSecret } from "../src/secretBind"

type Expect<T extends true> = T

type IsDisjoint<A, B> = keyof A & keyof B extends never ? true : false

type _SecretContractIdentity = Expect<IsDisjoint<typeof SecretContract, typeof SecretIdentity>>

type _SecretBind = Expect<
  IsDisjoint<typeof SecretContract & typeof SecretIdentity, { readonly bind: typeof bindSecret }>
>

type _EnvironmentBindRuntime = Expect<
  IsDisjoint<
    typeof EnvironmentContract,
    { readonly bind: typeof bindEnvironment; readonly runtime: typeof runtime }
  >
>

export type _Tests = readonly [_SecretContractIdentity, _SecretBind, _EnvironmentBindRuntime]
