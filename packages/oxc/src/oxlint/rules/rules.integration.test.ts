import { describe, expect, it } from "vitest"
import { lint } from "../test-support.ts"
import { noAmbientNondeterminism } from "./no-ambient-nondeterminism.ts"
import { noAny } from "./no-any.ts"
import { noBannedTypeAssertions } from "./no-banned-type-assertions.ts"
import { noBareError } from "./no-bare-error.ts"
import { noComments } from "./no-comments.ts"
import { noEffectAsVoid } from "./no-effect-asvoid.ts"
import { noMultipleFunctionParams } from "./no-multiple-function-params.ts"
import { noNodeChildProcess } from "./no-node-child-process.ts"
import { noParseCoercion } from "./no-parse-coercion.ts"
import { noRecordStringUndefined } from "./no-record-string-undefined.ts"
import { noServiceOption } from "./no-service-option.ts"
import { noSilentErrorSwallow } from "./no-silent-error-swallow.ts"
import { noSwitch } from "./no-switch.ts"
import { noSyncSchemaApis } from "./no-sync-schema-apis.ts"
import { noTryCatch } from "./no-try-catch.ts"
import { noTypeAssertion } from "./no-type-assertion.ts"
import { noYieldlessEffectGen } from "./no-yieldless-effect-gen.ts"
import { privateFunctionPrefix } from "./private-function-prefix.ts"

type Rule = Parameters<typeof lint>[0]["rule"]

interface Case {
  readonly name: string
  readonly source: string
  readonly reports: number
  readonly options?: ReadonlyArray<unknown>
}

const _suite = (input: { readonly name: string; readonly rule: Rule; readonly cases: ReadonlyArray<Case> }) =>
  describe(input.name, () => {
    input.cases.forEach((testCase) =>
      it(testCase.name, () => {
        const messages = lint({ rule: input.rule, source: testCase.source, options: testCase.options })
        expect(messages).toHaveLength(testCase.reports)
      })
    )
  })

_suite({
  name: "no-ambient-nondeterminism",
  rule: noAmbientNondeterminism,
  cases: [
    { name: "reports Math.random", source: "const x = Math.random()", reports: 1 },
    { name: "reports Date.now", source: "const x = Date.now()", reports: 1 },
    { name: "reports new Date()", source: "const x = new Date()", reports: 1 },
    { name: "allows new Date(arg)", source: "const x = new Date(0)", reports: 0 },
    { name: "allows other members", source: "const x = Math.floor(1)", reports: 0 }
  ]
})

_suite({
  name: "no-any",
  rule: noAny,
  cases: [
    { name: "reports value-level any", source: "const x: any = 1", reports: 1 },
    { name: "allows any in a type alias", source: "type A = Foo<any>", reports: 0 },
    { name: "allows any in an assertion", source: "const x = y as any", reports: 0 }
  ]
})

_suite({
  name: "no-banned-type-assertions",
  rule: noBannedTypeAssertions,
  cases: [
    { name: "reports as any", source: "const x = y as any", reports: 1 },
    { name: "reports as unknown", source: "const x = y as unknown", reports: 1 },
    { name: "reports as never", source: "const x = y as never", reports: 1 },
    { name: "reports nested any", source: "const x = y as any[]", reports: 1 },
    { name: "reports double assertions", source: "const x = y as A as B", reports: 1 },
    { name: "allows a plain assertion", source: "const x = y as string", reports: 0 },
    { name: "allows nested unknown", source: "const x = y as Record<string, unknown>", reports: 0 }
  ]
})

_suite({
  name: "no-bare-error",
  rule: noBareError,
  cases: [
    { name: "reports new Error as value", source: "const e = new Error('x')", reports: 1 },
    { name: "allows throw new Error", source: "throw new Error('x')", reports: 0 },
    { name: "allows other constructors", source: "const e = new Foo()", reports: 0 }
  ]
})

_suite({
  name: "no-comments",
  rule: noComments,
  cases: [
    { name: "reports non-JSDoc block", source: "/* nope */\nconst x = 1", reports: 1 },
    { name: "allows JSDoc", source: "/** doc */\nconst x = 1", reports: 0 },
    { name: "reports an overlong line comment", source: `// ${"x".repeat(151)}\nconst x = 1`, reports: 1 },
    { name: "allows a line comment of exactly 150", source: `//${"x".repeat(150)}\nconst x = 1`, reports: 0 },
    { name: "allows short line comments", source: "// short\nconst x = 1", reports: 0 },
    {
      name: "exempts directives, WHY and SAFETY",
      source: `// eslint-disable-next-line\n// konfig: WHY ${"x".repeat(200)}\n/* SAFETY: block */\nconst x = 1`,
      reports: 0
    }
  ]
})

_suite({
  name: "no-effect-asvoid",
  rule: noEffectAsVoid,
  cases: [
    { name: "reports Effect.asVoid", source: "pipe(a, Effect.asVoid)", reports: 1 },
    { name: "allows other Effect members", source: "pipe(a, Effect.map)", reports: 0 }
  ]
})

_suite({
  name: "no-multiple-function-params",
  rule: noMultipleFunctionParams,
  cases: [
    { name: "reports exported multi-arg", source: "export function f(a, b) {}", reports: 1 },
    { name: "allows non-exported by default", source: "function f(a, b) {}", reports: 0 },
    {
      name: "reports non-exported under scope all",
      source: "function f(a, b) {}",
      reports: 1,
      options: [{ scope: "all" }]
    },
    { name: "allows single param", source: "export function f(a) {}", reports: 0 },
    { name: "allows inline callbacks", source: "export const x = items.map((a, b) => a)", reports: 0 },
    {
      name: "reports nested helpers under scope all",
      source: "const f = () => { const inner = (a: number, b: number) => a + b }",
      reports: 1,
      options: [{ scope: "all" }]
    },
    {
      name: "allows nested helpers under scope exports",
      source: "export const f = () => { const inner = (a: number, b: number) => a + b }",
      reports: 0
    },
    {
      name: "allows nested inline callbacks",
      source: "const f = () => items.map((a, b) => a)",
      reports: 0,
      options: [{ scope: "all" }]
    },
    {
      name: "reports exported Effect.fn wrappers",
      source: "export const f = Effect.fn('f')(function* (a, b) {})",
      reports: 1
    },
    { name: "allows non-exported Effect.fn wrappers", source: "const f = Effect.fn(function* (a, b) {})", reports: 0 }
  ]
})

_suite({
  name: "no-node-child-process",
  rule: noNodeChildProcess,
  cases: [
    { name: "reports node:child_process", source: "import { exec } from 'node:child_process'", reports: 1 },
    { name: "reports bare child_process", source: "import { execSync } from 'child_process'", reports: 1 },
    { name: "reports require", source: "const c = require('child_process')", reports: 1 },
    { name: "reports require of node:", source: "const c = require('node:child_process')", reports: 1 },
    { name: "reports dynamic import", source: "const c = await import('node:child_process')", reports: 1 },
    { name: "reports export-from", source: "export * from 'child_process'", reports: 1 },
    { name: "reports named export-from", source: "export { exec } from 'node:child_process'", reports: 1 },
    { name: "allows other require", source: "const c = require('node:fs')", reports: 0 },
    { name: "allows other builtins", source: "import fs from 'node:fs'", reports: 0 }
  ]
})

_suite({
  name: "no-parse-coercion",
  rule: noParseCoercion,
  cases: [
    {
      name: "reports unsafeCoerce(YAML.parse())",
      source: "unsafeCoerce({ value: YAML.parse(s), reason: 'r' })",
      reports: 1
    },
    {
      name: "reports unsafeCoerce(JSON.parse())",
      source: "unsafeCoerce({ value: JSON.parse(s), reason: 'r' })",
      reports: 1
    },
    { name: "allows other values", source: "unsafeCoerce({ value, reason: 'r' })", reports: 0 }
  ]
})

_suite({
  name: "no-record-string-undefined",
  rule: noRecordStringUndefined,
  cases: [
    { name: "reports Record<string, undefined>", source: "type A = Record<string, undefined>", reports: 1 },
    { name: "allows Record<string, unknown>", source: "type A = Record<string, unknown>", reports: 0 },
    { name: "allows wrong arity", source: "type A = Record<string>", reports: 0 }
  ]
})

_suite({
  name: "no-service-option",
  rule: noServiceOption,
  cases: [
    { name: "reports Effect.serviceOption", source: "Effect.serviceOption(Tag)", reports: 1 },
    { name: "allows other members", source: "Effect.service(Tag)", reports: 0 }
  ]
})

_suite({
  name: "no-silent-error-swallow",
  rule: noSilentErrorSwallow,
  cases: [
    { name: "reports Effect.catch(() => Effect.void)", source: "Effect.catch(() => Effect.void)", reports: 1 },
    {
      name: "reports catchCause returning void",
      source: "Effect.catchCause(() => { return Effect.void })",
      reports: 1
    },
    { name: "reports orElseSucceed(() => undefined)", source: "Effect.orElseSucceed(() => undefined)", reports: 1 },
    { name: "reports Effect.ignore", source: "pipe(a, Effect.ignore)", reports: 1 },
    { name: "reports orElseSucceed false", source: "fs.exists(p).pipe(Effect.orElseSucceed(() => false))", reports: 1 },
    { name: "reports typed empty array", source: "Effect.orElseSucceed((): string[] => [])", reports: 1 },
    { name: "reports empty string", source: "Effect.orElseSucceed(() => \"\")", reports: 1 },
    { name: "reports null", source: "Effect.orElseSucceed(() => null)", reports: 1 },
    { name: "reports catch succeeding a constant", source: "Effect.catch(() => Effect.succeed(0))", reports: 1 },
    {
      name: "allows catch via a reason predicate",
      source: "Effect.catchIf(isNotFound, () => Effect.succeed(false))",
      reports: 0
    },
    { name: "allows meaningful recovery", source: "Effect.catch(recover)", reports: 0 },
    { name: "allows orElseSucceed with a value", source: "Effect.orElseSucceed(() => fallback)", reports: 0 }
  ]
})

_suite({
  name: "no-switch",
  rule: noSwitch,
  cases: [{ name: "reports switch", source: "switch (x) { default: break }", reports: 1 }]
})

_suite({
  name: "no-sync-schema-apis",
  rule: noSyncSchemaApis,
  cases: [
    { name: "reports Schema.decodeSync", source: "Schema.decodeSync(S)(x)", reports: 1 },
    { name: "reports the S alias", source: "S.encodeUnknownSync(X)(x)", reports: 1 },
    {
      name: "reports named imports from effect/Schema",
      source: "import { decodeSync } from 'effect/Schema'\ndecodeSync(S)(x)",
      reports: 1
    },
    {
      name: "reports aliased named imports",
      source: "import { asserts as a } from 'effect/Schema'\na(S)(x)",
      reports: 1
    },
    {
      name: "reports Result.getOrThrow over decodeResult",
      source: "Result.getOrThrow(Schema.decodeResult(S)(x))",
      reports: 1
    },
    {
      name: "reports Option.getOrThrow over decodeOption",
      source: "Option.getOrThrow(Schema.decodeOption(S)(x))",
      reports: 1
    },
    {
      name: "reports getOrThrow over a stored decoder",
      source: "const d = Schema.decodeResult(S)\nResult.getOrThrow(d(x))",
      reports: 1
    },
    { name: "allows getOrThrow over a non-Schema Result", source: "Result.getOrThrow(other(x))", reports: 0 },
    { name: "allows the Effect variant", source: "Schema.decodeEffect(S)(x)", reports: 0 },
    { name: "allows unrelated namespaces", source: "Other.decodeSync(S)(x)", reports: 0 },
    {
      name: "allows same-named imports from elsewhere",
      source: "import { decodeSync } from 'other'\ndecodeSync(x)",
      reports: 0
    }
  ]
})

_suite({
  name: "no-try-catch",
  rule: noTryCatch,
  cases: [{ name: "reports try statements", source: "try { a() } catch { b() }", reports: 1 }]
})

_suite({
  name: "no-type-assertion",
  rule: noTypeAssertion,
  cases: [
    { name: "reports as", source: "const x = y as string", reports: 1 },
    { name: "reports angle-bracket assertions", source: "const x = <string>y", reports: 1 },
    { name: "allows as const", source: "const x = y as const", reports: 0 }
  ]
})

_suite({
  name: "no-yieldless-effect-gen",
  rule: noYieldlessEffectGen,
  cases: [
    { name: "reports a generator without yield", source: "Effect.gen(function* () { return 1 })", reports: 1 },
    { name: "allows a yielding generator", source: "Effect.gen(function* () { yield* a })", reports: 0 },
    {
      name: "reports an outer yieldless gen wrapping a yielding one",
      source: "Effect.gen(function* () { const g = Effect.gen(function* () { yield* a }); return g })",
      reports: 1
    },
    { name: "ignores other calls", source: "Other.gen(function* () {})", reports: 0 },
    { name: "ignores arrows", source: "Effect.gen(() => 1)", reports: 0 }
  ]
})

_suite({
  name: "private-function-prefix",
  rule: privateFunctionPrefix,
  cases: [
    { name: "reports bare top-level function", source: "function foo() {}", reports: 1 },
    { name: "allows prefixed function", source: "function _foo() {}", reports: 0 },
    { name: "allows exported function", source: "export function foo() {}", reports: 0 },
    { name: "allows nested function", source: "function _a() { function foo() {} }", reports: 0 },
    { name: "reports bare arrow variable", source: "const bar = () => 1", reports: 1 },
    { name: "allows non-function variable", source: "const bar = 1", reports: 0 },
    { name: "allows locally exported function", source: "function foo() {}\nexport { foo }", reports: 0 },
    { name: "allows aliased local export", source: "const foo = () => 1\nexport { foo as bar }", reports: 0 },
    { name: "allows default-exported identifier", source: "function foo() {}\nexport default foo", reports: 0 }
  ]
})
