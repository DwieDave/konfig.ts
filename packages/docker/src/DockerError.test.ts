import { describe, expect, it } from "vitest"
import {
  type AnyDockerError,
  BuildScriptMissing,
  BunVersionUnsupported,
  CircularWorkspaceDep,
  DockerWriteError,
  DockerWriteRefused,
  EngineVersionMissing,
  MonorepoRootNotFound,
  SharedRootFileMissing,
  UnsupportedPm,
  WorkspaceNotFound,
  WorkspaceSourceUnknown
} from "./DockerError"

describe("DockerError", () => {
  it("constructs every tagged variant with its expected _tag", () => {
    const all: ReadonlyArray<readonly [AnyDockerError, string]> = [
      [new MonorepoRootNotFound({ from: "/x" }), "MonorepoRootNotFound"],
      [new WorkspaceNotFound({ target: "@x/y" }), "WorkspaceNotFound"],
      [
        new UnsupportedPm({ reason: "ambiguous", candidates: ["bun", "npm"] }),
        "UnsupportedPm"
      ],
      [
        new CircularWorkspaceDep({ cycle: ["@a", "@b", "@a"] }),
        "CircularWorkspaceDep"
      ],
      [
        new EngineVersionMissing({ target: "apps/x", engineField: "engines.bun" }),
        "EngineVersionMissing"
      ],
      [
        new BuildScriptMissing({ target: "apps/x", script: "build" }),
        "BuildScriptMissing"
      ],
      [
        new WorkspaceSourceUnknown({ target: "apps/x", missingWorkspace: "@y/z" }),
        "WorkspaceSourceUnknown"
      ],
      [
        new SharedRootFileMissing({ target: "apps/x", path: "tsconfig.base.json" }),
        "SharedRootFileMissing"
      ],
      [
        new DockerWriteRefused({ path: "Dockerfile", reason: "no marker" }),
        "DockerWriteRefused"
      ],
      [
        new DockerWriteError({ path: "Dockerfile", cause: new Error("perm") }),
        "DockerWriteError"
      ],
      [
        new BunVersionUnsupported({ target: "apps/x", version: "1.1.38", minimum: "1.2" }),
        "BunVersionUnsupported"
      ]
    ]

    expect(all).toHaveLength(11)

    for (const [err, tag] of all) {
      expect(err._tag).toBe(tag)
    }
  })

  it("preserves payload fields on construction", () => {
    const err = new WorkspaceSourceUnknown({
      target: "apps/kanban/server",
      missingWorkspace: "@konfig.ts/core"
    })

    expect(err.target).toBe("apps/kanban/server")
    expect(err.missingWorkspace).toBe("@konfig.ts/core")
  })
})
