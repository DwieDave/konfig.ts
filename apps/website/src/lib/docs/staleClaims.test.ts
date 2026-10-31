import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const DOCS_DIR = path.join(process.cwd(), "src", "content", "docs")
const PACKAGES_DIR = path.join(process.cwd(), "..", "..", "packages")

const walk = (dir: string): Array<string> =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)

    if (statSync(full).isDirectory()) return walk(full)

    return name.endsWith(".mdx") ? [full] : []
  })

const readmes = (): Array<string> =>
  readdirSync(PACKAGES_DIR)
    .map((name) => path.join(PACKAGES_DIR, name, "README.md"))
    .filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile() === true)

const STALE_CLAIMS: ReadonlyArray<RegExp> = [
  /HelmVersionTooLow[^\n|.]*(absent|missing)/,
  /`render\(\)` entrypoint/,
  /effect@\^4\.0\.0/,
  /platform-node@\^4\.0/,
  /Four are built in/,
  /_tag: "Sops" \|/,
  /number followed by `s`, `m`, or `h`/,
  /`target` is passed through unchanged/,
  /implement the `SecretBackend<N, K, RequiresSource>` contract/,
  /issueCount/,
  /`Namespace` and `Service`[^\n]*RFC 1123 \*?label/
]

describe("stale doc claims", () => {
  it.each([...walk(DOCS_DIR), ...readmes()])("%s has no stale claims", (file) => {
    const text = readFileSync(file, "utf8")

    expect(STALE_CLAIMS.filter((pattern) => pattern.test(text))).toEqual([])
  })
})
