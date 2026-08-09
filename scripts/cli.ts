#!/usr/bin/env bun
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Schema } from "effect"
import { Command } from "effect/unstable/cli"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { badgesCommand } from "./commands/badges"
import { bumpVersionCommand } from "./commands/bumpVersion"
import { prepackExportsCommand } from "./commands/prepackExports"
import { rewriteWorkspaceDepsCommand } from "./commands/rewriteWorkspaceDeps"
import { testCommand } from "./commands/test"
import { PackageJson, REPO_ROOT } from "./lib/repo"

const _version = Schema.decodeUnknownSync(PackageJson)(
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
).version ?? "0.0.0"

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
    badgesCommand
  ])
)

NodeRuntime.runMain(Command.run(root, { version: _version }).pipe(Effect.provide(NodeServices.layer)))
