import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { runProcessString } from "@konfig.ts/core"
import { plainArgs, stdinAsString, stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Secret } from "@konfig.ts/k8s"
import { Cause, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { ChildProcess } from "effect/process"
import type { StandardCommand } from "effect/process/ChildProcess"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { TestClock } from "effect/testing"
import { describe, expect } from "vitest"
import { Sops } from "./backend"
import { SopsEncryptedSecretSchema } from "./schema"

const _asSopsSecret = Schema.decodeUnknownEffect(SopsEncryptedSecretSchema)

const SOPS_ENCRYPT_OUTPUT = `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  secretTemplates:
    - name: db-creds
      type: Opaque
      stringData:
        url: ENC[AES256_GCM,data:STUBurl==,type:str]
        password: ENC[AES256_GCM,data:STUBpassword==,type:str]
sops:
  age:
    - recipient: age1mockstub
      enc: |
        -----BEGIN AGE ENCRYPTED FILE-----
        STUBPAYLOAD
        -----END AGE ENCRYPTED FILE-----
`.trim()

interface RecordedCall {
  readonly cmd: string
  readonly args: ReadonlyArray<string>
  readonly stdin: string
}

interface CallSink {
  calls: RecordedCall[]
}

const _makeStubSpawner = (
  sink: CallSink,
  respond: (cmd: StandardCommand) => string
): Layer.Layer<ChildProcessSpawner> =>
  stubSpawner({
    respond: (cmd) => ({ stdout: respond(cmd) }),
    sink: (cmd) =>
      stdinAsString(cmd).pipe(
        Effect.map((stdin) => {
          sink.calls.push({ cmd: cmd.command, args: plainArgs(cmd), stdin })
        })
      )
  })

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const ctx = { env: "prod" } as const

describe("Sops.backend (case B: konfig source → SopsSecret CR)", () => {
  it.effect("encrypts to a SopsSecret with age recipients", () =>
    Effect.gen(function*() {
      const sink: CallSink = { calls: [] }

      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({
          recipients: { age: ["age1stub00000000000000000000000000000000000000000000000000ends"] }
        }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const rendered = yield* _asSopsSecret(
        yield* bound.manifest!.render(ctx).pipe(
          Effect.provide(_makeStubSpawner(sink, () => SOPS_ENCRYPT_OUTPUT))
        )
      )

      expect(rendered.apiVersion).toBe("isindir.github.com/v1alpha3")
      expect(rendered.kind).toBe("SopsSecret")
      expect(rendered.spec.secretTemplates[0]?.stringData?.url).toContain("ENC[")
      const call = sink.calls[0]
      expect(call?.cmd).toBe("sops")
      expect(call?.args).toContain("--encrypt")
      expect(call?.args).toContain("--age")
      expect(call?.args).toContain("age1stub00000000000000000000000000000000000000000000000000ends")
      expect(call?.stdin).toContain("kind: SopsSecret")
      expect(call?.stdin).toContain("url: u")
    }).pipe(Effect.provide(NodeServices.layer)))

  const _encryptArgs = (encryptedRegex?: string) =>
    Effect.gen(function*() {
      const sink: CallSink = { calls: [] }

      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({
          recipients: { age: ["age1stub00000000000000000000000000000000000000000000000000ends"] },
          encryptedRegex
        }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      yield* bound.manifest!.render(ctx).pipe(
        Effect.provide(_makeStubSpawner(sink, () => SOPS_ENCRYPT_OUTPUT))
      )

      return sink.calls[0]?.args ?? []
    }).pipe(Effect.provide(NodeServices.layer))

  it.effect("passes the default --encrypted-regex limiting encryption to secret data", () =>
    Effect.gen(function*() {
      const args = yield* _encryptArgs()
      expect(args[args.indexOf("--encrypted-regex") + 1]).toBe("^(data|stringData)$")
    }))

  it.effect("ignores any ambient .sops.yaml by passing --config /dev/null", () =>
    Effect.gen(function*() {
      const args = yield* _encryptArgs()
      expect(args[args.indexOf("--config") + 1]).toBe("/dev/null")
    }))

  it.effect("passes a custom encryptedRegex through", () =>
    Effect.gen(function*() {
      const args = yield* _encryptArgs("^stringData$")
      expect(args[args.indexOf("--encrypted-regex") + 1]).toBe("^stringData$")
    }))
})

describe("Sops.passthrough (case C)", () => {
  it.effect("reads an encrypted file from disk and parses it as a SopsSecret", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const tmpFile = `${process.cwd()}/.tmp-sops-passthrough.yaml`
      yield* fs.writeFileString(tmpFile, SOPS_ENCRYPT_OUTPUT)

      try {
        const bound = Secret.bind({
          secret: dbCreds,
          backend: Sops.passthrough({ file: tmpFile })
        })

        const rendered = yield* _asSopsSecret(yield* bound.manifest!.render(ctx))
        expect(rendered.kind).toBe("SopsSecret")
        expect(rendered.spec.secretTemplates[0]?.name).toBe("db-creds")
      } finally {
        yield* fs.remove(tmpFile)
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  const partialFile = (body: string, encryptedRegex: string) =>
    `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  secretTemplates:
    - name: db-creds
      type: Opaque
      stringData:
${body}
sops:
  encrypted_regex: ${JSON.stringify(encryptedRegex)}
  age:
    - recipient: age1mockstub
      enc: STUB
`.trim()

  const renderPassthrough = (contents: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const tmpFile = `${process.cwd()}/.tmp-sops-passthrough-partial.yaml`
      yield* fs.writeFileString(tmpFile, contents)

      try {
        const bound = Secret.bind({
          secret: dbCreds,
          backend: Sops.passthrough({ file: tmpFile })
        })

        return yield* Effect.exit(bound.manifest!.render(ctx))
      } finally {
        yield* fs.remove(tmpFile)
      }
    })

  it.effect("accepts a partially-encrypted file: keys outside encrypted_regex may be plaintext", () =>
    Effect.gen(function*() {
      const exit = yield* renderPassthrough(partialFile(
        `        url: plain-username\n        password: ENC[AES256_GCM,data:STUB==,type:str]`,
        "^(password)$"
      ))

      expect(Exit.isSuccess(exit)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("rejects a partially-encrypted file whose regex-matched key is plaintext", () =>
    Effect.gen(function*() {
      const exit = yield* renderPassthrough(partialFile(
        `        url: plain\n        password: leaked-plaintext`,
        "^(password)$"
      ))

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        expect(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)).toContain("ENC[")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("still requires ENC[ everywhere when encrypted_regex matches a container key (stringData subtree)", () =>
    Effect.gen(function*() {
      const exit = yield* renderPassthrough(partialFile(
        `        url: plain\n        password: ENC[AES256_GCM,data:STUB==,type:str]`,
        "^(stringData|data)$"
      ))

      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("rejects a file whose encrypted_regex is not a valid regex", () =>
    Effect.gen(function*() {
      const exit = yield* renderPassthrough(partialFile(
        `        url: plain\n        password: plain`,
        "(["
      ))

      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  const _failureText = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit)
      ? Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
      : Effect.succeed("")

  it.effect("rejects a file that lacks a key required by the secret contract", () =>
    Effect.gen(function*() {
      const exit = yield* renderPassthrough(partialFile(
        `        url: ENC[AES256_GCM,data:STUB==,type:str]`,
        "^(url)$"
      ))

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* _failureText(exit)).toContain("password")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("rejects a file with more than one secretTemplates entry instead of renaming them all", () =>
    Effect.gen(function*() {
      const body = partialFile(
        `        url: ENC[AES256_GCM,data:STUB==,type:str]\n        password: ENC[AES256_GCM,data:STUB==,type:str]`,
        "^(url|password)$"
      ).replace(
        "sops:\n",
        "    - name: cache\n      stringData:\n        url: ENC[AES256_GCM,data:STUB==,type:str]\nsops:\n"
      )

      const exit = yield* renderPassthrough(body)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* _failureText(exit)).toContain("exactly one")
    }).pipe(Effect.provide(NodeServices.layer)))

  const namespaceMismatchFile = (macOnlyEncrypted: boolean | undefined) =>
    `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  secretTemplates:
    - name: db-creds
      type: Opaque
      stringData:
        url: ENC[AES256_GCM,data:STUBurl==,type:str]
        password: ENC[AES256_GCM,data:STUBpassword==,type:str]
sops:
${macOnlyEncrypted === undefined ? "" : `  mac_only_encrypted: ${macOnlyEncrypted}\n`}  age:
    - recipient: age1mockstub
      enc: STUB
`.trim()

  const stagingCreds = Secret.define({
    name: "db-creds",
    namespace: "staging",
    env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
  })

  const stagingCtx = { env: "staging" } as const

  const renderStagingPassthrough = (contents: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const tmpFile = `${process.cwd()}/.tmp-sops-passthrough-restamp.yaml`
      yield* fs.writeFileString(tmpFile, contents)

      try {
        const bound = Secret.bind({
          secret: stagingCreds,
          backend: Sops.passthrough({ file: tmpFile })
        })

        return yield* Effect.exit(bound.manifest!.render(stagingCtx))
      } finally {
        yield* fs.remove(tmpFile)
      }
    })

  it.effect("refuses to restamp metadata.namespace when the file is not mac_only_encrypted", () =>
    Effect.gen(function*() {
      const exit = yield* renderStagingPassthrough(namespaceMismatchFile(undefined))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        expect(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)).toContain(
          "mac_only_encrypted"
        )
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("restamps metadata.namespace when the file is mac_only_encrypted", () =>
    Effect.gen(function*() {
      const exit = yield* renderStagingPassthrough(namespaceMismatchFile(true))
      expect(Exit.isSuccess(exit)).toBe(true)

      if (Exit.isSuccess(exit)) {
        const rendered = yield* _asSopsSecret(exit.value)
        expect(rendered.metadata.namespace).toBe("staging")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  const nameMismatchFile = (macOnlyEncrypted: boolean | undefined) =>
    `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: other-secret
  namespace: prod
spec:
  secretTemplates:
    - name: other-secret
      type: Opaque
      stringData:
        url: ENC[AES256_GCM,data:STUBurl==,type:str]
        password: ENC[AES256_GCM,data:STUBpassword==,type:str]
sops:
${macOnlyEncrypted === undefined ? "" : `  mac_only_encrypted: ${macOnlyEncrypted}\n`}  age:
    - recipient: age1mockstub
      enc: STUB
`.trim()

  const renderPassthroughForDbCreds = (contents: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const tmpFile = `${process.cwd()}/.tmp-sops-passthrough-name-restamp.yaml`
      yield* fs.writeFileString(tmpFile, contents)

      try {
        const bound = Secret.bind({
          secret: dbCreds,
          backend: Sops.passthrough({ file: tmpFile })
        })

        return yield* Effect.exit(bound.manifest!.render(ctx))
      } finally {
        yield* fs.remove(tmpFile)
      }
    })

  it.effect(
    "refuses to pass through a file whose secret name doesn't match the bound secret, when not mac_only_encrypted",
    () =>
      Effect.gen(function*() {
        const exit = yield* renderPassthroughForDbCreds(nameMismatchFile(undefined))
        expect(Exit.isFailure(exit)).toBe(true)

        if (Exit.isFailure(exit)) {
          const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
          expect(text).toContain("mac_only_encrypted")
          expect(text).toContain("name")
        }
      }).pipe(Effect.provide(NodeServices.layer))
  )

  it.effect("restamps metadata.name and spec.secretTemplates[].name when the file is mac_only_encrypted", () =>
    Effect.gen(function*() {
      const exit = yield* renderPassthroughForDbCreds(nameMismatchFile(true))
      expect(Exit.isSuccess(exit)).toBe(true)

      if (Exit.isSuccess(exit)) {
        const rendered = yield* _asSopsSecret(exit.value)
        expect(rendered.metadata.name).toBe("db-creds")
        expect(rendered.spec.secretTemplates[0]?.name).toBe("db-creds")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  const metaFile = (macOnlyEncrypted: boolean | undefined) =>
    `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: db-creds
  namespace: prod
  labels:
    keep: "yes"
spec:
  secretTemplates:
    - name: db-creds
      type: Opaque
      stringData:
        url: ENC[AES256_GCM,data:STUBurl==,type:str]
        password: ENC[AES256_GCM,data:STUBpassword==,type:str]
sops:
${macOnlyEncrypted === undefined ? "" : `  mac_only_encrypted: ${macOnlyEncrypted}\n`}  age:
    - recipient: age1mockstub
      enc: STUB
`.trim()

  const renderWithMeta = (contents: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const tmpFile = `${process.cwd()}/.tmp-sops-passthrough-meta.yaml`
      yield* fs.writeFileString(tmpFile, contents)

      try {
        const bound = Secret.bind({
          secret: dbCreds,
          backend: Sops.passthrough({ file: tmpFile }),
          labels: { team: "core" },
          annotations: { note: "x" }
        })

        return yield* Effect.exit(bound.manifest!.render(ctx))
      } finally {
        yield* fs.remove(tmpFile)
      }
    })

  it.effect("merges bound labels and annotations when the file is mac_only_encrypted", () =>
    Effect.gen(function*() {
      const exit = yield* renderWithMeta(metaFile(true))
      expect(Exit.isSuccess(exit)).toBe(true)

      if (Exit.isSuccess(exit)) {
        const rendered = yield* _asSopsSecret(exit.value)
        expect(rendered.metadata.labels).toEqual({ keep: "yes", team: "core" })
        expect(rendered.metadata.annotations).toEqual({ note: "x" })
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("refuses to merge bound labels and annotations when the file is not mac_only_encrypted", () =>
    Effect.gen(function*() {
      const exit = yield* renderWithMeta(metaFile(undefined))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("metadata.labels")
        expect(text).toContain("metadata.annotations")
      }
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Sops.backend recipient input boundary", () => {
  const VALID_OUTPUT = SOPS_ENCRYPT_OUTPUT
  const validAge = "age1stub00000000000000000000000000000000000000000000000000ends"

  it.effect("rejects age recipient containing a comma (smuggled second key)", () =>
    Effect.gen(function*() {
      const sink: CallSink = { calls: [] }

      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({
          recipients: {
            age: [`${validAge},age1injected${"0".repeat(50)}leak`]
          }
        }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const exit = yield* Effect.exit(
        bound.manifest!.render(ctx).pipe(
          Effect.provide(_makeStubSpawner(sink, () => VALID_OUTPUT))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("SopsRecipients")
        expect(text).toContain("BoundaryDecodeError")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("rejects age recipient with shell metachars (semicolon)", () =>
    Effect.gen(function*() {
      const sink: CallSink = { calls: [] }

      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({
          recipients: { age: [`${validAge}; rm -rf /`] }
        }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const exit = yield* Effect.exit(
        bound.manifest!.render(ctx).pipe(
          Effect.provide(_makeStubSpawner(sink, () => VALID_OUTPUT))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Sops.backend fail-closed encryption check", () => {
  const PLAINTEXT_OUTPUT = `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  secretTemplates:
    - name: db-creds
      type: Opaque
      stringData:
        url: u
        password: p
`.trim()

  const ENCRYPTED_BLOCK_PLAINTEXT_VALUES = `
apiVersion: isindir.github.com/v1alpha3
kind: SopsSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  secretTemplates:
    - name: db-creds
      type: Opaque
      stringData:
        url: u
        password: p
sops:
  age:
    - recipient: age1mockstub
      enc: STUB
`.trim()

  const runWith = (output: string) =>
    Effect.gen(function*() {
      const sink: CallSink = { calls: [] }

      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({
          recipients: { age: ["age1stub00000000000000000000000000000000000000000000000000ends"] }
        }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      return yield* Effect.exit(
        bound.manifest!.render(ctx).pipe(
          Effect.provide(_makeStubSpawner(sink, () => output))
        )
      )
    })

  it.effect("rejects a plaintext-shaped document (no sops metadata block)", () =>
    Effect.gen(function*() {
      const exit = yield* runWith(PLAINTEXT_OUTPUT)
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("BoundaryDecodeError")
        expect(text).toContain("SopsSecret")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("rejects an encrypted-shaped document whose values are not ENC[ ciphertext", () =>
    Effect.gen(function*() {
      const exit = yield* runWith(ENCRYPTED_BLOCK_PLAINTEXT_VALUES)
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("SopsUnencryptedValueError")
        expect(text).toContain("ENC[")
        expect(text).toContain("db-creds")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("honours unencrypted_regex metadata when checking values", () =>
    Effect.gen(function*() {
      const exit = yield* runWith(
        ENCRYPTED_BLOCK_PLAINTEXT_VALUES.replace("sops:\n", "sops:\n  unencrypted_regex: \"^(url|password)$\"\n")
      )

      expect(Exit.isSuccess(exit)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("accepts a properly-encrypted document", () =>
    Effect.gen(function*() {
      const exit = yield* runWith(SOPS_ENCRYPT_OUTPUT)
      expect(Exit.isSuccess(exit)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Sops.backend schema boundary", () => {
  const MALFORMED_OUTPUT = `
apiVersion: wrong/v1
kind: NotASopsSecret
metadata:
  name: db-creds
`.trim()

  it.effect("BoundaryDecodeError if sops stdout doesn't match SopsSecret schema", () =>
    Effect.gen(function*() {
      const sink: CallSink = { calls: [] }

      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({
          recipients: { age: ["age1stub00000000000000000000000000000000000000000000000000ends"] }
        }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const exit = yield* Effect.exit(
        bound.manifest!.render(ctx).pipe(
          Effect.provide(_makeStubSpawner(sink, () => MALFORMED_OUTPUT))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("BoundaryDecodeError")
        expect(text).toContain("SopsSecret")
      }
    }).pipe(Effect.provide(NodeServices.layer)))
})

const _run = (command: string, args: readonly string[]) =>
  runProcessString({ command: ChildProcess.make(command, args) }).pipe(Effect.scoped, Effect.option)

const _freshAgeRecipient = Effect.gen(function*() {
  const out = yield* _run("age-keygen", [])

  return Option.flatMap(out, (text) => Option.fromNullishOr(/public key: (age1[0-9a-z]+)/.exec(text)?.[1]))
})

describe("Sops.backend with real sops (skipped when sops/age-keygen are absent)", () => {
  it.effect("encrypts with a fresh age key, decodes and restamps successfully", () =>
    Effect.gen(function*() {
      const sopsVersion = yield* _run("sops", ["--version"])
      const recipient = yield* _freshAgeRecipient

      if (Option.isNone(sopsVersion) || Option.isNone(recipient)) return

      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({ recipients: { age: [recipient.value] } }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const rendered = yield* _asSopsSecret(yield* bound.manifest!.render(ctx))
      expect(rendered.metadata.name).toBe("db-creds")
      expect(rendered.spec.secretTemplates[0]?.stringData?.url).toContain("ENC[")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Sops.backend timeout option", () => {
  it.effect("fails with ProcessTimeout when sops hangs past the configured timeout", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: Sops.backend({
          recipients: { age: ["age1stub00000000000000000000000000000000000000000000000000ends"] },
          timeout: "5 seconds"
        }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const fiber = yield* Effect.forkChild(
        Effect.exit(bound.manifest!.render(ctx).pipe(Effect.provide(stubSpawner({ respond: () => ({ hang: true }) }))))
      )

      yield* TestClock.adjust("6 seconds")
      const exit = yield* Fiber.join(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("timed out after 5s")
    }).pipe(Effect.provide(NodeServices.layer)))
})
