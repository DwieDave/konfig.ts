#!/usr/bin/env bun
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { bumpVersionCommand } from "./commands/bumpVersion"
import { coverageBadgeCommand } from "./commands/coverageBadge"
import { prepackExportsCommand } from "./commands/prepackExports"
import { rewriteWorkspaceDepsCommand } from "./commands/rewriteWorkspaceDeps"

const root = Command.make(
  "repo",
  {},
  () => Console.log("repo — konfig.ts maintenance scripts. Run with --help for available commands.")
).pipe(
  Command.withSubcommands([
    bumpVersionCommand,
    prepackExportsCommand,
    rewriteWorkspaceDepsCommand,
    coverageBadgeCommand
  ])
)

NodeRuntime.runMain(Command.run(root, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer)))
