import { createHash } from "node:crypto"

export const HEADER_MARKER = "# konfig-managed: @konfig.ts/docker"

const HASH_PREFIX = "# hash: sha256:"

export interface RenderHeaderInput {
  readonly specPath: string
  readonly body: string
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex")

export const renderHeader = (input: RenderHeaderInput): string => {
  const hash = sha256Hex(input.body)
  return [HEADER_MARKER, `# spec: ${input.specPath}`, `${HASH_PREFIX}${hash}`].join("\n")
}

export interface RenderFileInput {
  readonly specPath: string
  readonly body: string
}

export const renderFile = (input: RenderFileInput): string => {
  const header = renderHeader(input)
  return `${header}\n${input.body}`
}

export interface ExtractedHeader {
  readonly managed: boolean
  readonly specPath?: string
  readonly hash?: string
}

export const extractHeader = (file: string): ExtractedHeader => {
  const lines = file.split("\n", 3)
  if (lines.length < 3 || lines[0] !== HEADER_MARKER) return { managed: false }
  const specLine = lines[1] ?? ""
  const hashLine = lines[2] ?? ""
  const specPath = specLine.startsWith("# spec: ") ? specLine.slice("# spec: ".length) : undefined
  const hash = hashLine.startsWith(HASH_PREFIX) ? hashLine.slice(HASH_PREFIX.length) : undefined
  return { managed: true, specPath, hash }
}
