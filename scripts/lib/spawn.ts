import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { mapRepoError } from "./repo"

export const spawnInherit = (input: { readonly argv: ReadonlyArray<string>; readonly cwd?: string }) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const [cmd = "", ...args] = input.argv

      const handle = yield* spawner.spawn(
        ChildProcess.make(cmd, args, {
          cwd: input.cwd,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          extendEnv: true
        })
      )

      return Number(yield* handle.exitCode)
    })
  ).pipe(mapRepoError(`cannot spawn ${input.argv.join(" ")}`))
