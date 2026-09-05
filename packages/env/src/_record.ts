import { unsafeCoerce } from "@konfig.ts/core"
import { Config } from "effect"

type _ConfigSuccess<A> = [A] extends [Config.Config<infer T>] ? T : never

// Config.all's declared return type stays a deferred conditional for a generic
// record, so TS cannot relate it to the mapped success record; this is the one
// audited spot where that gap is bridged.
export const allConfigs = <M extends Readonly<Record<string, Config.Config<unknown>>>>(
  members: M
): Config.Config<{ readonly [K in keyof M]: _ConfigSuccess<M[K]> }> =>
  unsafeCoerce<Config.Config<{ readonly [K in keyof M]: _ConfigSuccess<M[K]> }>>(
    Config.all(members),
    "Config.all over a record resolves each member to its success type; the deferred conditional in its signature is exactly this mapped record"
  )

// Homogeneous variant: TS refuses to reduce the indexed access over the
// generic mapped input, so this carries its own audited coercion.
export const allConfigsByKey = <K extends string, V>(
  fields: { readonly [P in K]: Config.Config<V> }
): Config.Config<{ readonly [P in K]: V }> =>
  unsafeCoerce<Config.Config<{ readonly [P in K]: V }>>(
    Config.all(fields),
    "Config.all over a K-keyed record of Config<V> yields a Config of the K-keyed record of V"
  )

// Builds a record with exactly the given keys; the single coercion is sound
// because Object.fromEntries is fed one entry per K and nothing else.
export const collectByKey = <K extends string, V>(input: {
  readonly keys: ReadonlyArray<K>
  readonly build: (key: K) => V
}): { readonly [P in K]: V } =>
  unsafeCoerce<{ readonly [P in K]: V }>(
    Object.fromEntries(input.keys.map((key) => [key, input.build(key)])),
    "record built from exactly the given keys is the mapped type { [P in K]: V }"
  )

export const typedKeys = <D extends object>(d: D): Array<keyof D & string> =>
  unsafeCoerce<Array<keyof D & string>>(
    Object.keys(d),
    "Object.keys of D returns the string keys of D, i.e. Array<keyof D & string>"
  )
