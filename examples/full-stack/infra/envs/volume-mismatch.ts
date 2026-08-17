// Demonstrates: volume mounts must name a declared volume, and PVC claims must be branded refs.
import { Container, Pod, Port, PvcRef, Volume } from "@konfig.ts/k8s"

const data = Volume.fromPvc({ name: "data", claim: PvcRef.of("postgres-data") })

const _typo = Pod.define({
  volumes: [data],
  containers: [
    // @ts-expect-error "dat" is not a declared volume name ("data").
    Container.define({
      name: "postgres",
      image: "postgres:16",
      ports: [Port.make({ name: "pg", containerPort: 5432 })],
      volumeMounts: [{ name: Volume.mountRef("dat"), mountPath: "/var/lib/postgresql/data" }]
    })
  ]
})
void _typo

const _rawClaim = Volume.fromPvc({
  name: "data",
  // @ts-expect-error a plain string is not a PvcRef; use PvcRef.of(...) or a Dep.Pvc provider.
  claim: "postgres-data"
})
void _rawClaim

const _ok = Pod.define({
  volumes: [data],
  containers: [
    Container.define({
      name: "postgres",
      image: "postgres:16",
      ports: [Port.make({ name: "pg", containerPort: 5432 })],
      volumeMounts: [{ name: Volume.mountRef("data"), mountPath: "/var/lib/postgresql/data" }]
    })
  ]
})
void _ok
