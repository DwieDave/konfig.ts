#!/usr/bin/env bun
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { join } from "node:path"
import { badgesCommand } from "./commands/badges"
import { bumpVersionCommand } from "./commands/bumpVersion"
import { buildCommand, checkCommand, coverageCommand, packagesCommand } from "./commands/packageScript"
import { pkgCommand } from "./commands/pkg"
import { prepackExportsCommand } from "./commands/prepackExports"
import { rewriteWorkspaceDepsCommand } from "./commands/rewriteWorkspaceDeps"
import { testCommand } from "./commands/test"
import { readJson, REPO_ROOT } from "./lib/repo"

const root = Command.make(
  "repo",
  {},
  () => Console.log("repo — konfig.ts maintenance scripts. Run with --help for available commands.")
).pipe(
  Command.withSubcommands([
    bumpVersionCommand,
    prepackExportsCommand,
    rewriteWorkspaceDepsCommand,
    testCommand,
    badgesCommand,
    buildCommand,
    checkCommand,
    coverageCommand,
    packagesCommand,
    pkgCommand
  ])
)

const program = Effect.gen(function*() {
  const pkg = yield* readJson(join(REPO_ROOT, "package.json"))
  yield* Command.run(root, { version: pkg.version ?? "0.0.0" })
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
