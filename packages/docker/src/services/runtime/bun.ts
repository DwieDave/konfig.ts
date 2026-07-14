import type { Runtime } from "../Runtime"

export const bun: Runtime = {
  _tag: "Bun",
  imageRef: ({ version, alpine }) => ({
    image: "oven/bun",
    tag: `${version}${alpine ? "-alpine" : ""}`
  }),
  defaultDevWatch: (entry) => ["bun", "--watch", entry]
}
