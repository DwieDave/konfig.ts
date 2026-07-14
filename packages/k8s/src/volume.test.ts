import { describe, expect, it } from "vitest"
import { Container, Pod } from "./container"
import { Port } from "./ports"
import { Volume } from "./volume"

describe("Volume.empty / Volume.mountRef", () => {
  it("brands the volume name; underlying value is the literal string", () => {
    const v = Volume.empty({ name: "config" })
    expect(v.name).toBe("config")
    expect(v.emptyDir).toBeDefined()
  })

  it("Volume.mountRef returns the bare string at runtime", () => {
    expect(Volume.mountRef("config")).toBe("config")
  })
})

describe("Pod", () => {
  it("wires container volumeMounts to declared volumes by name", () => {
    const pod = Pod.define({
      volumes: [Volume.empty({ name: "config" }), Volume.empty({ name: "data" })],
      containers: [
        Container.define({
          name: "app",
          image: "ghcr.io/example/app:1.0.0",
          ports: [Port.make({ name: "http", containerPort: 8080 })],
          volumeMounts: [
            { name: Volume.mountRef("config"), mountPath: "/etc/conf" },
            { name: Volume.mountRef("data"), mountPath: "/var/data" }
          ]
        })
      ]
    })
    expect(pod.volumes).toHaveLength(2)
    expect(pod.containers).toHaveLength(1)
    expect(pod.containers[0]?.volumeMounts?.[0]).toEqual({
      name: "config",
      mountPath: "/etc/conf"
    })
  })

  it("works with no volumes / no mounts", () => {
    const pod = Pod.define({
      volumes: [],
      containers: [
        Container.define({
          name: "app",
          image: "x",
          ports: [Port.make({ name: "http", containerPort: 8080 })]
        })
      ]
    })
    expect(pod.volumes).toHaveLength(0)
    expect(pod.containers[0]?.volumeMounts).toBeUndefined()
  })

  it("supports initContainers under the same mount-name constraint", () => {
    const pod = Pod.define({
      volumes: [Volume.empty({ name: "data" })],
      initContainers: [
        Container.define({
          name: "init",
          image: "busybox",
          ports: [],
          volumeMounts: [{ name: Volume.mountRef("data"), mountPath: "/seed" }]
        })
      ],
      containers: [
        Container.define({
          name: "app",
          image: "x",
          ports: [Port.make({ name: "http", containerPort: 8080 })],
          volumeMounts: [{ name: Volume.mountRef("data"), mountPath: "/var/data" }]
        })
      ]
    })
    expect(pod.initContainers?.[0]?.volumeMounts?.[0]?.mountPath).toBe("/seed")
  })
})
