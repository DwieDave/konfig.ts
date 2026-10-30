import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { TestClock } from "effect/testing"
import { type FlightStore, singleFlight } from "./singleFlight"

const _store = () => new Map<string, Deferred.Deferred<number, string>>() satisfies FlightStore<string, number, string>

const _counted = (runs: Ref.Ref<number>) =>
  Ref.updateAndGet(runs, (n) => n + 1).pipe(Effect.tap(() => Effect.sleep("1 second")))

describe("singleFlight", () => {
  it.effect("runs once for concurrent callers", () =>
    Effect.gen(function*() {
      const runs = yield* Ref.make(0)
      const store = _store()
      const call = singleFlight({ store, key: "k", run: _counted(runs), keepOnSuccess: false })
      const fibers = yield* Effect.forEach([1, 2, 3, 4], () => Effect.forkChild(call))
      yield* TestClock.adjust("1 second")
      const results = yield* Effect.forEach(fibers, Fiber.join)
      expect(results).toEqual([1, 1, 1, 1])
      expect(yield* Ref.get(runs)).toBe(1)
    }))

  it.effect("drops the entry after failure", () =>
    Effect.gen(function*() {
      const store = _store()
      const failing = singleFlight({ store, key: "k", run: Effect.fail("boom"), keepOnSuccess: true })
      yield* Effect.flip(failing)
      const ok = yield* singleFlight({ store, key: "k", run: Effect.succeed(7), keepOnSuccess: true })
      expect(ok).toBe(7)
    }))

  it.effect("keepOnSuccess reuses the success", () =>
    Effect.gen(function*() {
      const runs = yield* Ref.make(0)
      const store = _store()
      const call = singleFlight({ store, key: "k", run: Ref.updateAndGet(runs, (n) => n + 1), keepOnSuccess: true })
      yield* call
      yield* call
      expect(yield* Ref.get(runs)).toBe(1)
    }))

  it.effect("without keepOnSuccess reruns", () =>
    Effect.gen(function*() {
      const runs = yield* Ref.make(0)
      const store = _store()
      const call = singleFlight({ store, key: "k", run: Ref.updateAndGet(runs, (n) => n + 1), keepOnSuccess: false })
      yield* call
      yield* call
      expect(yield* Ref.get(runs)).toBe(2)
    }))

  it.effect("waiter retries when the owner is interrupted", () =>
    Effect.gen(function*() {
      const store = _store()

      const owner = yield* Effect.forkChild(
        singleFlight({ store, key: "k", run: Effect.never, keepOnSuccess: false })
      )

      yield* Effect.yieldNow

      const waiter = yield* Effect.forkChild(
        singleFlight({ store, key: "k", run: Effect.succeed(42), keepOnSuccess: false })
      )

      yield* Effect.yieldNow
      yield* Fiber.interrupt(owner)

      expect(yield* Fiber.join(waiter)).toBe(42)
    }))
})
