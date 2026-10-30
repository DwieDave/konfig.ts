const _escapeRegExp = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")

const _segmentToRegExp = (segment: string): RegExp =>
  new RegExp(
    `^${
      segment.split("")
        .map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : _escapeRegExp(c)))
        .join("")
    }$`
  )

export interface SegmentInput {
  readonly segment: string
  readonly name: string
}

export const hasWildcard = (segment: string): boolean => /[*?]/.test(segment)

export const segmentMatches = (input: SegmentInput): boolean => _segmentToRegExp(input.segment).test(input.name)
