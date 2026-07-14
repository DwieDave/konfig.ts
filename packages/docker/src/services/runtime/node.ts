import type { Runtime } from "../Runtime"

export const node: Runtime = {
  _tag: "Node",
  imageRef: ({ version, alpine }) => ({
    image: "node",
    tag: `${version}${alpine ? "-alpine" : ""}`
  })
}
