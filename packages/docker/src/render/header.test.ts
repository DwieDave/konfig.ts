import { sha256Hex } from "@konfig.ts/core"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { extractHeader, HEADER_MARKER, renderFile, renderHeader } from "./header"

describe("generation header", () => {
  const body = "FROM alpine:3.20 AS base\n"
  const specPath = "apps/x/docker.ts"

  it("renderHeader emits three lines: marker, spec, hash", () => {
    const h = renderHeader({ specPath, body })
    const lines = h.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(HEADER_MARKER)
    expect(lines[1]).toBe(`# spec: ${specPath}`)
    expect(lines[2]).toBe(`# hash: sha256:${sha256Hex(body)}`)
  })

  it("renderFile prepends the header and a newline before the body", () => {
    const f = renderFile({ specPath, body })
    expect(f.startsWith(`${HEADER_MARKER}\n`)).toBe(true)
    expect(f.endsWith(`\n${body}`)).toBe(true)
  })

  it("renderHeader is deterministic across calls", () => {
    const a = renderHeader({ specPath, body })
    const b = renderHeader({ specPath, body })
    expect(a).toBe(b)
  })

  it("renderFile is deterministic across calls (NFR-2)", () => {
    expect(renderFile({ specPath, body })).toBe(renderFile({ specPath, body }))
  })

  it("hash changes iff body changes (NFR-3 idempotency precondition)", () => {
    const a = renderHeader({ specPath, body })
    const b = renderHeader({ specPath, body: `${body}# trailing\n` })
    expect(a).not.toBe(b)
  })

  it("hash is stable when only specPath changes", () => {
    const a = renderHeader({ specPath, body })
    const b = renderHeader({ specPath: `other/${specPath}`, body })
    const hashA = a.split("\n")[2]
    const hashB = b.split("\n")[2]
    expect(hashA).toBe(hashB)
  })

  it("extractHeader recognizes our own output and returns specPath + hash", () => {
    const f = renderFile({ specPath, body })
    const e = extractHeader(f)
    expect(e.managed).toBe(true)
    expect(e.specPath).toBe(specPath)
    expect(e.hash).toBe(sha256Hex(body))
  })

  it("extractHeader rejects unmanaged content", () => {
    expect(extractHeader("FROM alpine\nRUN echo hi\n").managed).toBe(false)
    expect(extractHeader("# random comment\nFROM alpine\n").managed).toBe(false)
    expect(extractHeader("").managed).toBe(false)
  })

  it("rendering twice with the same inputs is byte-identical end-to-end", () => {
    expect(renderFile({ specPath, body })).toBe(renderFile({ specPath, body }))
  })

  const specPathArb = fc.stringMatching(/^[A-Za-z0-9_./-]{1,40}$/)

  it("round-trips: extractHeader(renderFile) is managed with the same specPath and body hash (property)", () => {
    fc.assert(fc.property(specPathArb, fc.string(), (path, text) => {
      const head = extractHeader(renderFile({ specPath: path, body: text }))

      return head.managed && head.specPath === path && head.hash === sha256Hex(text)
    }))
  })

  it("stays managed when the file was saved with CRLF line endings (property)", () => {
    fc.assert(fc.property(specPathArb, fc.string(), (path, text) => {
      const crlf = renderFile({ specPath: path, body: text }).replace(/\n/g, "\r\n")
      const head = extractHeader(crlf)

      return head.managed && head.specPath === path && head.hash === sha256Hex(text)
    }))
  })
})
