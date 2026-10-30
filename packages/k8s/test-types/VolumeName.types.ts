import { Container, Pod, Port, PvcRef, Volume } from "@konfig.ts/k8s"
import type { DefinedPod } from "../src/container"
import type { Volume as VolumeT, VolumeNamesOf } from "../src/volume"

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

const claim = PvcRef.of("data-claim")

const cfg = Volume.fromPvc({ name: "config", claim })

type _CfgN = Expect<Equal<typeof cfg, VolumeT<"config">>>

type _EmptyN = Expect<Equal<ReturnType<typeof Volume.empty<"scratch">>, VolumeT<"scratch">>>

type _SecretN = Expect<Equal<ReturnType<typeof Volume.fromSecret<"creds">>, VolumeT<"creds">>>

type _ConfigMapN = Expect<Equal<ReturnType<typeof Volume.fromConfigMap<"conf">>, VolumeT<"conf">>>

type Vs = readonly [VolumeT<"config">, VolumeT<"data">]

type _Names = Expect<Equal<VolumeNamesOf<Vs>, "config" | "data">>

const goodPod = Pod.define({
  volumes: [Volume.empty({ name: "config" }), Volume.fromPvc({ name: "data", claim })],
  containers: [
    Container.define({
      name: "app",
      image: "x",
      ports: [Port.make({ name: "http", containerPort: 8080 })],
      volumeMounts: [
        { name: Volume.mountRef("config"), mountPath: "/etc/conf" },
        { name: Volume.mountRef("data"), mountPath: "/var/data" }
      ]
    })
  ]
})

type _PodNames = Expect<Equal<typeof goodPod, DefinedPod<"config" | "data">>>

const _typo = Pod.define({
  volumes: [Volume.fromPvc({ name: "config", claim })],
  containers: [
    // @ts-expect-error - "cnofig" is not in declared volume names ("config").
    Container.define({
      name: "app",
      image: "x",
      ports: [Port.make({ name: "http", containerPort: 8080 })],
      volumeMounts: [{ name: Volume.mountRef("cnofig"), mountPath: "/etc/conf" }]
    })
  ]
})

const _otherPod = Pod.define({
  volumes: [Volume.fromPvc({ name: "logs", claim })],
  containers: [
    Container.define({
      name: "log",
      image: "x",
      ports: [],
      volumeMounts: [{ name: Volume.mountRef("logs"), mountPath: "/var/log" }]
    })
  ]
})

const _crossPod = Pod.define({
  volumes: [Volume.fromPvc({ name: "config", claim })],
  containers: [
    // @ts-expect-error - "logs" was declared on _otherPod, not this one.
    Container.define({
      name: "app",
      image: "x",
      ports: [],
      volumeMounts: [{ name: Volume.mountRef("logs"), mountPath: "/var/log" }]
    })
  ]
})

const _empty = Pod.define({
  volumes: [],
  containers: [
    Container.define({
      name: "app",
      image: "x",
      ports: []
    })
  ]
})

void _typo

void _otherPod

void _crossPod

void _empty

export type _Tests = readonly [_CfgN, _EmptyN, _SecretN, _ConfigMapN, _Names, _PodNames]
