import { unsafeCoerce } from "@konfig.ts/core"

export const _entriesOf = <O extends object>(
  obj: O
): ReadonlyArray<readonly [keyof O & string, O[keyof O]]> =>
  unsafeCoerce<ReadonlyArray<readonly [keyof O & string, O[keyof O]]>>({
    value: Object.entries(obj),
    reason: "Object.entries yields the object's own enumerable string keys and their values"
  })
