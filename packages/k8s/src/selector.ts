import { unsafeCoerce } from "@konfig.ts/core"
import type { StringMap } from "./meta"

declare const SelectorBrand: unique symbol

export interface Selector<L extends StringMap> {
  readonly [SelectorBrand]: L
  readonly labels: L
}

export const Selector = {
  make: <const L extends StringMap>(labels: L): Selector<L> =>
    unsafeCoerce<Selector<L>>(
      { labels },
      "SelectorBrand is a unique-symbol phantom — no runtime value; runtime shape is { labels }"
    )
}

export type SelectorLabels<S> = S extends Selector<infer L> ? L : never
