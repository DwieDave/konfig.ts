import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { FAILURE_CASES, load } from "@/lib/catalog"

const DOCS_DIR = path.join(process.cwd(), "src", "content", "docs")

const walk = (dir: string): Array<string> =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return name.endsWith(".mdx") || name.endsWith(".md") ? [full] : []
  })

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{"([^"]*)"\\})`))
  return m?.[1] ?? m?.[2] ?? m?.[3]
}

const linesAttr = (tag: string): readonly [number, number] | undefined => {
  const m = tag.match(/\blines=\{\[\s*(\d+)\s*,\s*(\d+)\s*\]\}/)
  return m ? [Number(m[1]), Number(m[2])] : undefined
}

describe("MDX snippet usages", () => {
  const files = walk(DOCS_DIR)

  it("finds docs pages", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const rel = path.relative(DOCS_DIR, file)
    const source = readFileSync(file, "utf8")

    it(`${rel}: every <Snippet> resolves`, () => {
      const tags = source.match(/<Snippet\b[^>]*\/?>/g) ?? []
      for (const tag of tags) {
        const f = attr(tag, "file")
        expect(f, tag).toBeDefined()
        if (f === undefined) continue
        const startAt = attr(tag, "startAt")
        const startAfter = attr(tag, "startAfter")
        const endBefore = attr(tag, "endBefore")
        const lines = linesAttr(tag)
        const between = startAt !== undefined || startAfter !== undefined || endBefore !== undefined
          ? {
            ...(startAt !== undefined ? { startAt } : {}),
            ...(startAfter !== undefined ? { startAfter } : {}),
            ...(endBefore !== undefined ? { endBefore } : {})
          }
          : undefined
        const snippet = load({ file: f, ...(between ? { between } : {}), ...(lines ? { lines } : {}), stripMeta: true })
        expect(snippet.code.trim().length, tag).toBeGreaterThan(0)
      }
    })

    it(`${rel}: every <Diagnostics> case exists`, () => {
      const tags = source.match(/<Diagnostics\b[^>]*\/?>/g) ?? []
      for (const tag of tags) {
        const id = attr(tag, "case")
        expect(FAILURE_CASES.some((c) => c.id === id), tag).toBe(true)
      }
    })

    it(`${rel}: has no em-dashes and valid frontmatter`, () => {
      // Quoted program output inside code may contain an em-dash; prose must not.
      const prose = source.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "")
      expect(prose.includes("—"), "em-dash in prose").toBe(false)
      expect(source.startsWith("---\n"), "frontmatter").toBe(true)
      expect(/^title:\s*.+$/m.test(source), "title").toBe(true)
    })
  }
})
