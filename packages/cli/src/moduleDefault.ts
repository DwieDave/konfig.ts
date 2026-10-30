import { isRecord } from "@konfig.ts/core"

export const moduleDefault = (mod: unknown): unknown => isRecord(mod) && "default" in mod ? mod.default : undefined
