import type { ImageRef } from "./PackageManager"

export interface RuntimeImageInput {
  readonly version: string
  readonly alpine: boolean
}

export interface Runtime {
  readonly kind: "Bun" | "Node"
  readonly imageRef: (input: RuntimeImageInput) => ImageRef
}
