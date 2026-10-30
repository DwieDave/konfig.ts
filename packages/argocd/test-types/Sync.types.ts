import { Sync } from "../src/sync"

Sync.wave(-1)

Sync.wave(0)

// @ts-expect-error non-integer literal
Sync.wave(1.5)

// @ts-expect-error exponent literal
Sync.wave(1e-7)
