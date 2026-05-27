#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { buildCommand } from "./commands/build";
import { crdCommand } from "./commands/crd";
import { diffCommand } from "./commands/diff";
import { dockerCommand } from "./commands/docker";
import { helmCommand } from "./commands/helmFetch";
import { setCommand } from "./commands/set";
import { validateCommand } from "./commands/validate";

const root = Command.make("konfig", {}, () =>
	Console.log("konfig — typesafe Kubernetes config. Run with --help for available commands."),
).pipe(
	Command.withSubcommands([
		buildCommand,
		validateCommand,
		diffCommand,
		crdCommand,
		helmCommand,
		setCommand,
		dockerCommand,
	]),
);

NodeRuntime.runMain(Command.run(root, { version: "0.0.1" }).pipe(Effect.provide(NodeServices.layer)));
