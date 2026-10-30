const SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/

const shSingleQuote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`

const _shQuote = (s: string): string => (SAFE_TOKEN.test(s) ? s : shSingleQuote(s))

export const shJoin = (argv: ReadonlyArray<string>): string => argv.map(_shQuote).join(" ")

export const shGlobQuote = (path: string): string =>
  path
    .split(/([*?])/)
    .map((part) => (part === "*" || part === "?" ? part : part === "" ? "" : shSingleQuote(part)))
    .join("")
