import type { ContainerSpec, NamesOf } from "@konfig.ts/k8s"
import { Container, Port, Service, Workload } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type PortsTuple = readonly [
  ReturnType<typeof Port.make<"http">>,
  ReturnType<typeof Port.make<"metrics">>
]
type _Names = Expect<Equal<NamesOf<PortsTuple>, "http" | "metrics">>

const api = Container.define({
  name: "api",
  image: "x",
  ports: [
    Port.make({ name: "http", containerPort: 8080 }),
    Port.make({ name: "metrics", containerPort: 9090 })
  ]
})
type _ApiSpec = Expect<Equal<typeof api, ContainerSpec<"http" | "metrics", never>>>

const okProbe = Container.define({
  name: "api",
  image: "x",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  readinessProbe: { httpGet: { path: "/h", port: Port.ref("http") } }
})
void okProbe

const badProbe = Container.define({
  name: "api",
  image: "x",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  readinessProbe: {
    // @ts-expect-error - "grpc" is not in declared port names ("http").
    httpGet: { path: "/h", port: Port.ref("grpc") }
  }
})
void badProbe

const numericProbe = Container.define({
  name: "api",
  image: "x",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  readinessProbe: { httpGet: { path: "/h", port: 8080 } }
})
void numericProbe

const _okSvc = Service.fromContainer({
  name: "api",
  namespace: "default",
  selector: { app: "api" },
  forContainer: api,
  ports: [{ port: 80, targetPort: Port.ref("http") }]
})

const _badSvc = Service.fromContainer({
  name: "api",
  namespace: "default",
  selector: { app: "api" },
  forContainer: api,
  ports: [
    // @ts-expect-error - "admin" is not in api's declared port names ("http" | "metrics").
    { port: 80, targetPort: Port.ref("admin") }
  ]
})

void _okSvc
void _badSvc

const _okWeb = Workload.web({
  name: "api",
  namespace: "default",
  deployment: { replicas: 1, containers: [api] },
  service: { ports: [{ port: 80, targetPort: Port.ref("http") }] }
})

const _badWeb = Workload.web({
  name: "api",
  namespace: "default",
  deployment: { replicas: 1, containers: [api] },
  service: {
    ports: [
      // @ts-expect-error - "admin" is not in api's declared port names ("http" | "metrics").
      { port: 80, targetPort: Port.ref("admin") }
    ]
  }
})

const _numericWeb = Workload.web({
  name: "api",
  namespace: "default",
  deployment: { replicas: 1, containers: [api] },
  service: { ports: [{ port: 80, targetPort: 8080 }] }
})

const _untypedWeb = Workload.web({
  name: "api",
  namespace: "default",
  deployment: {
    replicas: 1,
    containers: [{ name: "api", image: "x", ports: [{ containerPort: 8080 }] }]
  },
  service: { ports: [{ port: 80, targetPort: 8080 }] }
})

void _okWeb
void _badWeb
void _numericWeb
void _untypedWeb

export type _Tests = readonly [_Names, _ApiSpec]
