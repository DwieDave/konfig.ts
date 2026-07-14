import type { ImageRef } from "./PackageManager"

export interface RuntimeImageInput {
  readonly version: string
  readonly alpine: boolean
}

export interface Runtime {
  readonly _tag: "Bun" | "Node"
  readonly imageRef: (input: RuntimeImageInput) => ImageRef
}
