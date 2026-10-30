import { unsafeCoerce } from "./_cast"

export type OmitUndefined<T extends object> = { readonly [K in keyof T]?: Exclude<T[K], undefined> }

export const omitUndefined = <T extends object>(input: T): OmitUndefined<T> =>
  unsafeCoerce<OmitUndefined<T>>(
    Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    "filtering entries only drops keys, so every remaining value is already Exclude<T[K], undefined>"
  )
