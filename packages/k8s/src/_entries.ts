import { unsafeCoerce } from "@konfig.ts/core"

export const _entriesOf = <O extends object>(
  obj: O
): ReadonlyArray<readonly [keyof O & string, O[keyof O]]> =>
  unsafeCoerce<ReadonlyArray<readonly [keyof O & string, O[keyof O]]>>(
    Object.entries(obj),
    "Object.entries yields the object's own enumerable string keys and their values"
  )
