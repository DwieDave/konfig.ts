#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Option, Schema } from "effect"
import { Command } from "effect/cli"
import { createRequire } from "node:module"
import { buildCommand } from "./commands/build"
import { crdCommand } from "./commands/crd"
import { diffCommand } from "./commands/diff"
import { dockerCommand } from "./commands/docker"
import { graphCommand } from "./commands/graph"
import { helmCommand } from "./commands/helmFetch"
import { setCommand } from "./commands/set"
import { validateCommand } from "./commands/validate"
import { _reportFailure } from "./reportFailure"

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

// At runtime this module is `dist/main.mjs`, so `../package.json` resolves to
// the package root in both source and bundled layouts.
const _pkg: unknown = createRequire(import.meta.url)("../package.json")

const version = Option.match(Schema.decodeUnknownOption(Schema.Struct({ version: Schema.String }))(_pkg), {
  onNone: () => "0.0.0",
  onSome: (pkg) => pkg.version
})

NodeRuntime.runMain(
  Command.run(root, { version }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.tapCause(_reportFailure)
  ),
  { disableErrorReporting: true }
)
