#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { unsafeCoerce } from "@konfig.ts/core"
import { Console, Effect } from "effect"
import { createRequire } from "node:module"
import { Command } from "./_unstable"
import { buildCommand } from "./commands/build"
import { crdCommand } from "./commands/crd"
import { diffCommand } from "./commands/diff"
import { dockerCommand } from "./commands/docker"
import { graphCommand } from "./commands/graph"
import { helmCommand } from "./commands/helmFetch"
import { setCommand } from "./commands/set"
import { validateCommand } from "./commands/validate"

const root = Command.make(
  "konfig",
  {},
  () => Console.log("konfig — typesafe Kubernetes config. Run with --help for available commands.")
).pipe(
  Command.withSubcommands([
    buildCommand,
    validateCommand,
    diffCommand,
    crdCommand,
    helmCommand,
    setCommand,
    dockerCommand,
    graphCommand
  ])
)

// Single source of truth for the version: the shipped package.json. At
// runtime this module is `dist/main.mjs`, so `../package.json` resolves to
// the package root package.json in both source and bundled layouts.
const { version } = unsafeCoerce<{ version: string }>(
  createRequire(import.meta.url)("../package.json"),
  "package.json parsed as JSON — reading its string `version` field"
)

NodeRuntime.runMain(Command.run(root, { version }).pipe(Effect.provide(NodeServices.layer)))
