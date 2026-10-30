import { Effect } from "effect"
import { type CircularWorkspaceDep, WorkspaceNotFound } from "../DockerError"
import { closureOf, lookupWorkspace, type Workspace } from "../services/WorkspaceGraph"

export const closureByRef = (input: {
  readonly all: ReadonlyArray<Workspace>
  readonly ref: string
  readonly includeDev?: boolean
}): Effect.Effect<ReadonlyArray<Workspace>, WorkspaceNotFound | CircularWorkspaceDep> => {
  const target = lookupWorkspace({ all: input.all, ref: input.ref })

  return target
    ? closureOf({ all: input.all, target, includeDev: input.includeDev ?? false })
    : Effect.fail(new WorkspaceNotFound({ target: input.ref }))
}
