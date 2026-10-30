export interface Semver {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: ReadonlyArray<string>
}

const _SEMVER_RE = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

// A bare major.minor is read as major.minor.0.
export const parseSemver = (text: string): Semver | null => {
  const m = _SEMVER_RE.exec(text.trim())
  if (m === null) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3] ?? 0),
    prerelease: m[4] === undefined ? [] : m[4].split(".")
  }
}

const _sign = (n: number): number => n < 0 ? -1 : n > 0 ? 1 : 0

const _isNumeric = (id: string): boolean => /^\d+$/.test(id)

interface _IdPair {
  readonly a: string
  readonly b: string
}
const _compareId = ({ a, b }: _IdPair): number => {
  if (_isNumeric(a) && _isNumeric(b)) return _sign(Number(a) - Number(b))
  if (_isNumeric(a)) return -1
  if (_isNumeric(b)) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

interface _PrePair {
  readonly a: ReadonlyArray<string>
  readonly b: ReadonlyArray<string>
}
const _comparePrerelease = ({ a, b }: _PrePair): number => {
  if (a.length === 0 || b.length === 0) return _sign(b.length - a.length)
  const firstDiff = a.slice(0, b.length).map((id, i) => _compareId({ a: id, b: b[i] ?? "" })).find((c) => c !== 0)
  return firstDiff ?? _sign(a.length - b.length)
}

export interface SemverPair {
  readonly a: Semver
  readonly b: Semver
}
export const compareSemver = ({ a, b }: SemverPair): number =>
  _sign(a.major - b.major) ||
  _sign(a.minor - b.minor) ||
  _sign(a.patch - b.patch) ||
  _comparePrerelease({ a: a.prerelease, b: b.prerelease })
