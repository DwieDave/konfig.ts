import { expect, it } from "vitest"
import * as K8s from "./index"

const HIDDEN = ["encryptWithCli", "decodeYamlOutput", "encryptVia", "plainSecret", "secretMeta", "SecretBackend"]

const USED = ["define", "encrypting", "plainSecret", "secretMeta"]

it("the root barrel hides backend-author helpers", () => {
  expect(Object.keys(K8s).filter((key) => HIDDEN.includes(key))).toEqual([])
})

it("Backend exposes exactly the members the backend packages use", () => {
  expect(Object.keys(K8s.Backend).sort()).toEqual(USED)
})
