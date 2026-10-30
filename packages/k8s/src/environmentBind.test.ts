import { type EnvMember, Literal, SecretSource } from "@konfig.ts/env"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { bindEnvironment } from "./environmentBind"
import { Environment, NativeSecret, Secret } from "./index"

const secretOf = (envName: string) => Secret.define({ name: `s-${envName}`, namespace: "prod", env: { v: envName } })

const secretA = Secret.define({ name: "s-a", namespace: "prod", env: { v: "A" } })
const secretB = Secret.define({ name: "s-b", namespace: "prod", env: { v: "B" } })

interface _Tree<T> {
  readonly [key: string]: T | _Tree<T>
}

const options = (tag: string) => ({
  backend: NativeSecret.backend({ silenceWarning: true }),
  source: SecretSource.literal({ data: { v: tag } })
})

describe("Environment.bind keyed by member kind", () => {
  it("a secret member literally named `source` is bound", () => {
    const bound = Environment.bind({
      env: Environment.define({ source: secretA, other: secretB }),
      secrets: { source: options("a"), other: options("b") }
    })

    expect(bound.manifests).toHaveLength(2)
  })

  it("a literal member literally named `backend` takes its override", () => {
    const bound = Environment.bind({
      env: Environment.define({ backend: Literal.define({ envName: "BACKEND", value: "x" }) }),
      literals: { backend: "y" }
    })

    expect(bound.envVars).toEqual([{ name: "BACKEND", value: "y" }])
  })
})

const memberName = fc.oneof(
  fc.constantFrom("source", "backend", "_tag", "labels", "annotations"),
  fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/)
)

interface _Spec {
  readonly name: string
  readonly kind: "secret" | "literal" | "env"
  readonly children: ReadonlyArray<_Spec>
}

const _spec = (depth: number): fc.Arbitrary<ReadonlyArray<_Spec>> =>
  fc.uniqueArray(memberName, { minLength: 1, maxLength: 4 }).chain((names) =>
    fc.tuple(...names.map((name) =>
      depth === 0
        ? fc.constantFrom<"secret" | "literal">("secret", "literal").map((kind): _Spec => ({
          name,
          kind,
          children: []
        }))
        : fc.oneof(
          fc.constantFrom<"secret" | "literal">("secret", "literal").map((kind): _Spec => ({
            name,
            kind,
            children: []
          })),
          _spec(depth - 1).map((children): _Spec => ({ name, kind: "env", children }))
        )
    ))
  )

interface _Built {
  readonly members: Record<string, EnvMember>
  readonly secrets: _Tree<ReturnType<typeof options>>
  readonly literals: _Tree<string>
  readonly secretCount: number
  readonly literalEnvNames: ReadonlyArray<string>
}

const _build = (input: { readonly specs: ReadonlyArray<_Spec>; readonly prefix: string }): _Built =>
  input.specs.reduce<_Built>((acc, spec, index) => {
    const id = `${input.prefix}_${index}`

    if (spec.kind === "secret") {
      return {
        ...acc,
        members: { ...acc.members, [spec.name]: secretOf(id) },
        secrets: { ...acc.secrets, [spec.name]: options(id) },
        secretCount: acc.secretCount + 1
      }
    }

    if (spec.kind === "literal") {
      return {
        ...acc,
        members: { ...acc.members, [spec.name]: Literal.define({ envName: id, value: "d" }) },
        literals: { ...acc.literals, [spec.name]: `ov-${id}` },
        literalEnvNames: [...acc.literalEnvNames, id]
      }
    }

    const inner = _build({ specs: spec.children, prefix: id })

    return {
      members: { ...acc.members, [spec.name]: Environment.define(inner.members) },
      secrets: { ...acc.secrets, [spec.name]: inner.secrets },
      literals: { ...acc.literals, [spec.name]: inner.literals },
      secretCount: acc.secretCount + inner.secretCount,
      literalEnvNames: [...acc.literalEnvNames, ...inner.literalEnvNames]
    }
  }, { members: {}, secrets: {}, literals: {}, secretCount: 0, literalEnvNames: [] })

describe("Environment.bind properties", () => {
  it("binds every secret member and applies every literal override, whatever the member names", () => {
    fc.assert(
      fc.property(_spec(2), (specs) => {
        const built = _build({ specs, prefix: "E" })

        const bound = bindEnvironment({
          env: Environment.define(built.members),
          secrets: built.secrets,
          literals: built.literals
        })

        expect(bound.manifests).toHaveLength(built.secretCount)
        built.literalEnvNames.forEach((id) => {
          expect(bound.envVars.find((e) => e.name === id)?.value).toBe(`ov-${id}`)
        })
      })
    )
  })
})
