import type { Runtime } from "../Runtime"

export const node: Runtime = {
  kind: "Node",
  imageRef: ({ version, alpine }) => ({
    image: "node",
    tag: `${version}${alpine ? "-alpine" : ""}`
  })
}
