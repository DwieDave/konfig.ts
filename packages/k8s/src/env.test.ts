import { describe, expect, it } from "vitest"
import { EnvVar } from "./env"

describe("EnvVar.value", () => {
  it("returns a plain name/value pair", () => {
    const env = EnvVar.value({ name: "LOG_LEVEL", value: "debug" })
    expect(env).toEqual({ name: "LOG_LEVEL", value: "debug" })
  })
})

describe("EnvVar.raw", () => {
  it("passes a literal value through unchanged", () => {
    const env = EnvVar.raw({ name: "NODE_ENV", value: "production" })
    expect(env).toEqual({ name: "NODE_ENV", value: "production" })
  })

  it("passes a valueFrom (e.g. fieldRef) through unchanged, bypassing ref branding", () => {
    const env = EnvVar.raw({
      name: "POD_NAME",
      valueFrom: { fieldRef: { fieldPath: "metadata.name" } }
    })
    expect(env).toEqual({
      name: "POD_NAME",
      valueFrom: { fieldRef: { fieldPath: "metadata.name" } }
    })
  })
})
