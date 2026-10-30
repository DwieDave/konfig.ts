import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

const _packagesDir = join(__dirname, "..", "..")

const _walk = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)

    return name === "node_modules" || name === "dist" ? [] : statSync(full).isDirectory() ? _walk(full) : [full]
  })

const _testFiles = readdirSync(_packagesDir).flatMap((pkg) => {
  const src = join(_packagesDir, pkg, "src")

  return statSync(join(_packagesDir, pkg)).isDirectory() && readdirSync(join(_packagesDir, pkg)).includes("src")
    ? _walk(src).filter((f) => f.endsWith(".test.ts"))
    : []
})

it("no test file re-implements the fake child-process handle", () => {
  const offenders = _testFiles.filter((f) =>
    /\bmakeHandle\(/.test(readFileSync(f, "utf8")) && !f.endsWith(".guard.test.ts")
  )

  expect(offenders).toEqual([])
})
