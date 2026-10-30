const SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/

const _shSingleQuote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`

const _shQuote = (s: string): string => (SAFE_TOKEN.test(s) ? s : _shSingleQuote(s))

export const shJoin = (argv: ReadonlyArray<string>): string => argv.map(_shQuote).join(" ")

export const shGlobQuote = (path: string): string =>
  path
    .split(/([*?])/)
    .map((part) => (part === "*" || part === "?" ? part : part === "" ? "" : _shSingleQuote(part)))
    .join("")
