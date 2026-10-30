import { Match } from "effect"

const _escapeRegExp = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")

const _charPattern = (c: string): string =>
  Match.value(c).pipe(
    Match.when("*", () => "[^/]*"),
    Match.when("?", () => "[^/]"),
    Match.orElse(_escapeRegExp)
  )

const _segmentToRegExp = (segment: string): RegExp =>
  new RegExp(
    `^${
      segment.split("")
        .map((c) => _charPattern(c))
        .join("")
    }$`
  )

export interface SegmentInput {
  readonly segment: string
  readonly name: string
}

export const hasWildcard = (segment: string): boolean => /[*?]/.test(segment)

export const segmentMatches = (input: SegmentInput): boolean => _segmentToRegExp(input.segment).test(input.name)
