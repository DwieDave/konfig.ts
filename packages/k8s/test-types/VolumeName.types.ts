// Compile-time assertions for VolumeName<N> + Pod: container
// volumeMounts referring to undeclared volumes fail at the call site.

import type { DefinedPod, Volume as VolumeT, VolumeNamesOf } from "@konfig.ts/k8s"
import { Container, Pod, Port, Volume } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

// 1 · Volume factories carry the literal name in the brand.
const cfg = Volume.empty({ name: "config" })
type _CfgN = Expect<Equal<typeof cfg, VolumeT<"config">>>

// 2 · VolumeNamesOf<V> extracts the union of literal names.
type Vs = readonly [VolumeT<"config">, VolumeT<"data">]
type _Names = Expect<Equal<VolumeNamesOf<Vs>, "config" | "data">>

// 3 · `Pod` infers the pod's volume-name union from the volumes
//     tuple and surfaces it on `DefinedPod<...>`.
const goodPod = Pod.define({
  volumes: [Volume.empty({ name: "config" }), Volume.empty({ name: "data" })],
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

// 4 · BROKEN — container mounts a name not declared on the pod.
const _typo = Pod.define({
  volumes: [Volume.empty({ name: "config" })],
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

// 5 · BROKEN — cross-pod mount reference.
const _otherPod = Pod.define({
  volumes: [Volume.empty({ name: "logs" })],
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
  volumes: [Volume.empty({ name: "config" })],
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

// 6 · Empty volumes — containers may have no volumeMounts; ok.
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

export type _Tests = readonly [_CfgN, _Names, _PodNames]
