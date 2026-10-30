import type { Runtime } from "../Runtime"

export const bun: Runtime = {
  kind: "Bun",
  imageRef: ({ version, alpine }) => ({
    image: "oven/bun",
    tag: `${version}${alpine ? "-alpine" : ""}`
  })
}
