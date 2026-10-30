import type { ImageRef } from "./PackageManager"

interface RuntimeImageInput {
  readonly version: string
  readonly alpine: boolean
}

export interface Runtime {
  readonly kind: "Bun" | "Node"
  readonly imageRef: (input: RuntimeImageInput) => ImageRef
}
