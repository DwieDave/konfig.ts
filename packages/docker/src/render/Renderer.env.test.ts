import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { Dockerfile } from "../ir/DockerfileIR"
import { render } from "./Renderer"

const envLine = (value: string): string => {
  const df: Dockerfile = {
    args: [],
    stages: [{
      name: "x",
      from: { _tag: "FromStage", stage: "base" },
      instructions: [{ _tag: "Env", entries: [["K", value]] }]
    }]
  }
  return render(df).split("\n").find((l) => l.startsWith("ENV "))!
}

const decodeWord = (word: string): string => {
  let out = ""
  let quoted = false
  for (let i = 0; i < word.length; i++) {
    const c = word[i]!
    if (c === "\\" && (!quoted || "\"\\$".includes(word[i + 1] ?? ""))) out += word[++i]
    else if (c === "\"") quoted = !quoted
    else out += c
  }
  return out
}

const isEscaped = (s: string, i: number): boolean => {
  let n = 0
  for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) n++
  return n % 2 === 1
}

const chars = fc.constantFrom("a", "b", "$", "{", "}", "\\", "\"", " ", "'", "1")
const value = fc.array(chars, { minLength: 1, maxLength: 8 }).map((cs) => cs.join(""))

describe("ENV value escaping", () => {
  it("never leaves an unescaped $ that Docker would interpolate", () => {
    fc.assert(
      fc.property(value, (v) => {
        const line = envLine(v)
        for (let i = 0; i < line.length; i++) {
          if (line[i] === "$") expect(isEscaped(line, i)).toBe(true)
        }
      })
    )
  })

  it("decodes back to the original value", () => {
    fc.assert(
      fc.property(value, (v) => {
        expect(decodeWord(envLine(v).slice("ENV K=".length))).toBe(v)
      })
    )
  })
})
