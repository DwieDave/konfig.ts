import { expect, it } from "vitest"
import * as K8s from "./index"

const HIDDEN = ["encryptWithCli", "decodeYamlOutput", "encryptVia", "plainSecret", "secretMeta", "SecretBackend"]

const USED = ["define", "encrypting", "plainSecret", "secretMeta"]

it("the root barrel hides backend-author helpers", () => {
  expect(Object.keys(K8s).filter((key) => HIDDEN.includes(key))).toEqual([])
})

it("Service and NetworkPolicy do not expose a raw make constructor", () => {
  expect(Object.keys(K8s.Service)).not.toContain("make")
  expect(Object.keys(K8s.NetworkPolicy)).not.toContain("make")
})

it("Backend exposes exactly the members the backend packages use", () => {
  expect(Object.keys(K8s.Backend).sort()).toEqual(USED)
})
