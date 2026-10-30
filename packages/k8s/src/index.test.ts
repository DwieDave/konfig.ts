import { expect, it } from "vitest"
import * as K8s from "./index"

const HIDDEN = ["encryptWithCli", "decodeYamlOutput", "encryptVia", "plainSecret", "secretMeta", "SecretBackend"]

const USED = ["define", "encrypting", "plainSecret", "secretMeta"]

const BUILDERS: ReadonlyArray<readonly [string, object, ReadonlyArray<string>]> = [
  ["StatefulSet", K8s.StatefulSet, ["make"]],
  ["Job", K8s.Job, ["make"]],
  ["CronJob", K8s.CronJob, ["make"]],
  ["Workload", K8s.Workload, ["cron", "web"]],
  ["PersistentVolume", K8s.PersistentVolume, ["make"]],
  ["PersistentVolumeClaim", K8s.PersistentVolumeClaim, ["make"]],
  ["Volume", K8s.Volume, ["empty", "fromConfigMap", "fromPvc", "fromSecret", "mountRef"]],
  ["Role", K8s.Role, ["make"]],
  ["RoleBinding", K8s.RoleBinding, ["make"]],
  ["ClusterRole", K8s.ClusterRole, ["make"]],
  ["ClusterRoleBinding", K8s.ClusterRoleBinding, ["make"]],
  ["NetworkPolicy", K8s.NetworkPolicy, ["fromPodSet", "make"]],
  ["ServiceAccount", K8s.ServiceAccount, ["make"]],
  ["Service", K8s.Service, ["fromContainer", "fromPodSet", "make"]],
  ["Ingress", K8s.Ingress, ["make", "tls"]],
  ["PodSet", K8s.PodSet, ["define"]],
  ["SecretRef", K8s.SecretRef, ["of"]],
  ["ConfigMapRef", K8s.ConfigMapRef, ["of"]],
  ["ServiceAccountRef", K8s.ServiceAccountRef, ["of"]],
  ["PvcRef", K8s.PvcRef, ["of"]],
  ["Pod", K8s.Pod, ["define", "imagePullSecret"]]
]

it("the root barrel hides backend-author helpers", () => {
  expect(Object.keys(K8s).filter((key) => HIDDEN.includes(key))).toEqual([])
})

it.each(BUILDERS)("%s exposes exactly its documented builders", (_name, builder, members) => {
  expect(Object.keys(builder).sort()).toEqual(members)
})

it("EnvVar exposes raw and not the removed fromSecretForPod duplicate", () => {
  expect(Object.keys(K8s.EnvVar)).toContain("raw")
  expect(Object.keys(K8s.EnvVar)).not.toContain("fromSecretForPod")
})

it("SecretRef does not expose the removed unsafeReNamespace escape hatch", () => {
  expect(Object.keys(K8s.SecretRef)).not.toContain("unsafeReNamespace")
})

it("Backend exposes exactly the members the backend packages use", () => {
  expect(Object.keys(K8s.Backend).sort()).toEqual(USED)
})
