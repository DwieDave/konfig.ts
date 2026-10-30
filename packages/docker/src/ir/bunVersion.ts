// `bun install --filter` against a text bun.lock needs bun >= 1.2.
export const MIN_FILTERED_INSTALL = { major: 1, minor: 2 } as const

const _parseMajorMinor = (version: string): { major: number; minor: number } | undefined => {
  const m = version.match(/^(\d+)(?:\.(\d+))?/)

  return m ? { major: Number(m[1]), minor: Number(m[2] ?? 0) } : undefined
}

// Unparseable values (e.g. "latest") can't be judged, so they pass.
export const supportsFilteredInstall = (version: string): boolean => {
  const v = _parseMajorMinor(version)

  if (!v) return true

  return v.major !== MIN_FILTERED_INSTALL.major
    ? v.major > MIN_FILTERED_INSTALL.major
    : v.minor >= MIN_FILTERED_INSTALL.minor
}
