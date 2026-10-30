import { describe, expect, it } from "vitest"
import { Container, Pod } from "./container"
import { Port } from "./ports"
import { ConfigMapRef, PvcRef, SecretRef } from "./refs"
import { Volume } from "./volume"

const claim = PvcRef.of("data-claim")

describe("Volume.fromPvc / Volume.mountRef", () => {
  it("brands the volume name; underlying value is the literal string", () => {
    const v = Volume.fromPvc({ name: "config", claim })
    expect(v.name).toBe("config")
    expect(v.persistentVolumeClaim?.claimName).toBe("data-claim")
  })

  it("Volume.mountRef returns the bare string at runtime", () => {
    expect(Volume.mountRef("config")).toBe("config")
  })
})

describe("Volume.empty / Volume.fromSecret / Volume.fromConfigMap", () => {
  it("Volume.empty brands the name and emits an emptyDir", () => {
    const v = Volume.empty({ name: "scratch", medium: "Memory", sizeLimit: "64Mi" })
    expect(v.name).toBe("scratch")
    expect(v.emptyDir).toEqual({ medium: "Memory", sizeLimit: "64Mi" })
  })

  it("Volume.fromSecret maps the ref to secret.secretName", () => {
    const v = Volume.fromSecret({ name: "creds", ref: SecretRef.of("api-creds"), defaultMode: 0o400 })
    expect(v.name).toBe("creds")
    expect(v.secret).toEqual({ secretName: "api-creds", defaultMode: 0o400 })
  })

  it("Volume.fromConfigMap maps the ref to configMap.name and copies items", () => {
    const items = [{ key: "app.conf", path: "app.conf" }]
    const v = Volume.fromConfigMap({ name: "conf", ref: ConfigMapRef.of("app-config"), items })
    expect(v.configMap).toEqual({ name: "app-config", items })
    expect(v.configMap?.items).not.toBe(items)
    expect(v.configMap?.items?.[0]).not.toBe(items[0])
  })
})

describe("Pod", () => {
  it("wires container volumeMounts to declared volumes by name", () => {
    const pod = Pod.define({
      volumes: [Volume.fromPvc({ name: "config", claim }), Volume.fromPvc({ name: "data", claim })],
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
      volumes: [Volume.fromPvc({ name: "data", claim })],
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
