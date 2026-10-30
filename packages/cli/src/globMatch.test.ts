import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"
import { matchesGlob } from "./globMatch"

const _name = fc.stringMatching(/^[a-z0-9]{1,8}$/)

describe("matchesGlob", () => {
  it("property: a glob-free pattern matches only itself", () => {
    fc.assert(
      fc.property(_name, _name, _name, (a, b, other) => {
        const pattern = `${a}/${b}.ts`
        expect(matchesGlob({ pattern, path: pattern })).toBe(true)
        expect(matchesGlob({ pattern, path: `${a}/${b}${other}.ts` })).toBe(false)
      })
    )
  })

  it("property: braces match each alternative and nothing else", () => {
    fc.assert(
      fc.property(_name, _name, (dir, file) => {
        const pattern = `${dir}/*.{json,yaml}`
        expect(matchesGlob({ pattern, path: `${dir}/${file}.json` })).toBe(true)
        expect(matchesGlob({ pattern, path: `${dir}/${file}.yaml` })).toBe(true)
        expect(matchesGlob({ pattern, path: `${dir}/${file}.toml` })).toBe(false)
        expect(matchesGlob({ pattern, path: `${dir}/sub/${file}.json` })).toBe(false)
      })
    )
  })

  it("property: a/**/foo.ts matches zero or more directories but not a suffix of the name", () => {
    fc.assert(
      fc.property(_name, fc.array(_name, { maxLength: 3 }), _name, (root, mids, prefix) => {
        const pattern = `${root}/**/foo.ts`
        expect(matchesGlob({ pattern, path: [root, ...mids, "foo.ts"].join("/") })).toBe(true)
        expect(matchesGlob({ pattern, path: [root, ...mids, `${prefix}foo.ts`].join("/") })).toBe(false)
      })
    )
  })

  it("property: ? matches exactly one non-separator character", () => {
    fc.assert(
      fc.property(_name, fc.stringMatching(/^[a-z]$/), (stem, ch) => {
        expect(matchesGlob({ pattern: `${stem}?.ts`, path: `${stem}${ch}.ts` })).toBe(true)
        expect(matchesGlob({ pattern: `${stem}?.ts`, path: `${stem}.ts` })).toBe(false)
        expect(matchesGlob({ pattern: `${stem}?.ts`, path: `${stem}/.ts` })).toBe(false)
      })
    )
  })

  it("a trailing /** matches everything below the directory", () => {
    expect(matchesGlob({ pattern: "src/**", path: "src/a/b.ts" })).toBe(true)
    expect(matchesGlob({ pattern: "src/**", path: "other/a.ts" })).toBe(false)
  })

  it("supports nested braces, character classes and escaped specials", () => {
    expect(matchesGlob({ pattern: "x/{a,b{1,2}}.ts", path: "x/b2.ts" })).toBe(true)
    expect(matchesGlob({ pattern: "x/[ab].ts", path: "x/c.ts" })).toBe(false)
    expect(matchesGlob({ pattern: "x/[!ab].ts", path: "x/c.ts" })).toBe(true)
    expect(matchesGlob({ pattern: "x/a.b", path: "x/aXb" })).toBe(false)
    expect(matchesGlob({ pattern: "x/{a", path: "x/{a" })).toBe(true)
  })
})

describe("matchesGlob: totality and separator rules", () => {
  it("property: * never matches across a path separator", () => {
    fc.assert(
      fc.property(_name, _name, _name, (dir, a, b) => {
        expect(matchesGlob({ pattern: `${dir}/*`, path: `${dir}/${a}/${b}` })).toBe(false)
        expect(matchesGlob({ pattern: `${dir}/*`, path: `${dir}/${a}` })).toBe(true)
      })
    )
  })

  it("property: **/ prefix matches a file at any directory depth", () => {
    fc.assert(
      fc.property(fc.array(_name, { maxLength: 4 }), _name, (dirs, file) => {
        const path = [...dirs, `${file}.ts`].join("/")
        expect(matchesGlob({ pattern: "**/*.ts", path })).toBe(true)
        expect(matchesGlob({ pattern: "**/*.ts", path: `${path}x` })).toBe(false)
      })
    )
  })

  it("property: every arbitrary pattern compiles and matching is total", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), fc.string({ maxLength: 24 }), (pattern, path) => {
        expect(typeof matchesGlob({ pattern, path })).toBe("boolean")
      })
    )
  })
})
