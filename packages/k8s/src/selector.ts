import { unsafeCoerce } from "@konfig.ts/core"

declare const SelectorBrand: unique symbol

export interface Selector<L extends Readonly<Record<string, string>>> {
  readonly [SelectorBrand]: L
  readonly labels: L
}

export const Selector = {
  make: <const L extends Readonly<Record<string, string>>>(labels: L): Selector<L> =>
    unsafeCoerce<Selector<L>>(
      { labels },
      "SelectorBrand is a unique-symbol phantom — no runtime value; runtime shape is { labels }"
    )
}

export type SelectorLabels<S> = S extends Selector<infer L> ? L : never
