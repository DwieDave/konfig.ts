import type { Selector as SelectorT, SelectorLabels } from "@konfig.ts/k8s"
import { Deployment, PodSet, Selector, Service } from "@konfig.ts/k8s"

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

const apiPods = Selector.make({ app: "api", tier: "web" })
type ApiLabels = SelectorLabels<typeof apiPods>
type _ApiLabels = Expect<Equal<ApiLabels, { readonly app: "api"; readonly tier: "web" }>>

const dbPods = Selector.make({ app: "postgres" })
type DbLabels = SelectorLabels<typeof dbPods>
type _DbLabels = Expect<Equal<DbLabels, { readonly app: "postgres" }>>

type _NotAssignable = Expect<
  Equal<typeof dbPods extends SelectorT<ApiLabels> ? true : false, false>
>

const _okDep = Deployment.fromPodSet({
  name: "api",
  namespace: "default",
  podSet: apiPods,
  template: { spec: { containers: [{ name: "api", image: "x" }] } }
})

const _okSvc = Service.fromPodSet({
  name: "api",
  namespace: "default",
  podSet: apiPods,
  ports: [{ port: 80 }]
})

const _okTrio = PodSet.define({
  podSet: apiPods,
  deployment: {
    name: "api",
    namespace: "default",
    replicas: 2,
    template: { spec: { containers: [{ name: "api", image: "x" }] } }
  },
  service: { name: "api", namespace: "default", ports: [{ port: 80 }] },
  netPol: {
    name: "api-ingress",
    namespace: "default",
    ingress: [{ from: [{ podSet: dbPods }] }]
  }
})

// @ts-expect-error - Selector<{app:"postgres"}> not assignable to Selector<{app:"api",tier:"web"}>.
const _wrongAssign: typeof apiPods = dbPods

void _okDep
void _okSvc
void _okTrio
void _wrongAssign

export type _Tests = readonly [_ApiLabels, _DbLabels, _NotAssignable]
