import { ConfigMap, Secret, Volume, Workload } from "@konfig.ts/k8s"

const secret = Secret.make({ name: "s1", namespace: "prod", stringData: { k: "v" } })
const cm = ConfigMap.make({ name: "cm1", namespace: "prod", data: { k: "v" } })

const _secretVol = { name: Volume.mountRef("v"), secret: { secretName: secret.ref } }
const _cmVol = { name: Volume.mountRef("v"), configMap: { name: cm.ref } }

// @ts-expect-error - raw string is not a SecretRef.
const _rawSecretVol: Volume = { name: Volume.mountRef("v"), secret: { secretName: "nope" } }

// @ts-expect-error - raw string is not a ConfigMapRef.
const _rawCmVol: Volume = { name: Volume.mountRef("v"), configMap: { name: "nope" } }

const base = {
  name: "api",
  namespace: "prod",
  deployment: { containers: [{ name: "app", image: "nginx" }] },
  service: { ports: [{ port: 80, targetPort: 80 }] }
} as const

const _reloaderOk = Workload.web({ ...base, reloader: { secrets: [secret.ref], configMaps: [cm.ref] } })

// @ts-expect-error - raw strings are not SecretRefs.
const _rawReloader = Workload.web({ ...base, reloader: { secrets: ["s1"] } })

void [_secretVol, _cmVol, _rawSecretVol, _rawCmVol, _reloaderOk, _rawReloader]
