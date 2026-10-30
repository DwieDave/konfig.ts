import { Effect, Layer } from "effect"
import * as Fs from "effect/FileSystem"
import * as P from "effect/Path"

export const makeStubLayer = (files: Map<string, string>) =>
  Layer.mergeAll(
    Fs.layerNoop({
      readFileString: (file: string) => Effect.succeed(files.get(file) ?? ""),
      writeFileString: (file: string, data: string) => Effect.sync(() => void files.set(file, data))
    }),
    P.layer
  )
