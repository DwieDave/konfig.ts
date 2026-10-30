import { describe, expect, it } from "vitest"
import { EnvVar } from "./env"

describe("EnvVar.value", () => {
  it("returns a plain name/value pair", () => {
    const env = EnvVar.value({ name: "LOG_LEVEL", value: "debug" })
    expect(env).toEqual({ name: "LOG_LEVEL", value: "debug" })
  })
})
