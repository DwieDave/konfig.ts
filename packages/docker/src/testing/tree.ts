import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"

export type Files = Readonly<Record<string, string>>

export const pkgJson = (input: { readonly name: string; readonly extra?: object }): string =>
  JSON.stringify({ name: input.name, version: "1.0.0", ...input.extra })

export const rootPkgJson = (input: { readonly workspaces: ReadonlyArray<string>; readonly extra?: object }): string =>
  JSON.stringify({ name: "root", workspaces: input.workspaces, ...input.extra })

export const writeTree = (files: Files) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const dir = yield* fs.makeTempDirectoryScoped()
    for (const [rel, content] of Object.entries(files)) {
      yield* fs.makeDirectory(`${dir}/${rel.split("/").slice(0, -1).join("/")}`, { recursive: true })
      yield* fs.writeFileString(`${dir}/${rel}`, content)
    }
    return dir
  })
