#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { unsafeCoerce } from "@konfig.ts/core"
import { Cause, Console, Effect, Runtime } from "effect"
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

// At runtime this module is `dist/main.mjs`, so `../package.json` resolves to
// the package root in both source and bundled layouts.
const { version } = unsafeCoerce<{ version: string }>(
  createRequire(import.meta.url)("../package.json"),
  "package.json parsed as JSON — reading its string `version` field"
)

const _FULL_CAUSE_LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "trace", "all"])

// `--log-level` is a global flag Command.run installs *inside* the program, so
// the failure hook below can't read it from context; argv is the one place
// both it and `--verbose` are visible at the top level.
const _wantsFullCause = (argv: readonly string[]): boolean => {
  if (argv.includes("--verbose")) return true
  const at = argv.indexOf("--log-level")
  const level = at >= 0
    ? argv[at + 1]
    : argv.find((arg) => arg.startsWith("--log-level="))?.slice("--log-level=".length)
  return level !== undefined && _FULL_CAUSE_LOG_LEVELS.has(level.toLowerCase())
}

// Tagged errors without a `message` getter still carry their fields; those are
// the message in that case, so the line never ends in a bare tag.
const _errorFields = (error: Error): string => {
  const fields: string[] = []
  for (const [key, value] of Object.entries(error)) {
    if (key === "_tag" || key === "cause" || typeof value === "function") continue
    fields.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
  }
  return fields.join(" ")
}

const _oneLiner = (error: unknown): string => {
  if (error instanceof Error) {
    const tag = "_tag" in error && typeof error._tag === "string" ? `${error._tag}: ` : ""
    const body = error.message.length > 0 ? error.message : _errorFields(error)
    return `${tag}${body}`
  }
  return String(error)
}

// Replaces runMain's default reporter, which logs the whole Cause tree: a
// tagged error's message already says what went wrong (chart, phase, exit
// code, stderr tail). The tree is still available under --verbose or a debug
// log level. Interrupts and errors the CLI has already rendered (help) stay silent.
const _reportFailure = (cause: Cause.Cause<unknown>): Effect.Effect<void> => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void
  const error = Cause.squash(cause)
  if (!Runtime.getErrorReported(error)) return Effect.void
  return _wantsFullCause(process.argv)
    ? Console.error(Cause.pretty(cause))
    : Console.error(`konfig: ${_oneLiner(error)}`)
}

NodeRuntime.runMain(
  Command.run(root, { version }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.tapCause(_reportFailure)
  ),
  { disableErrorReporting: true }
)
