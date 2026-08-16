import { noAmbientNondeterminism } from "./rules/no-ambient-nondeterminism.ts"
import { noAny } from "./rules/no-any.ts"
import { noBannedTypeAssertions } from "./rules/no-banned-type-assertions.ts"
import { noBareError } from "./rules/no-bare-error.ts"
import { noComments } from "./rules/no-comments.ts"
import { noEffectAsVoid } from "./rules/no-effect-asvoid.ts"
import { noMultipleFunctionParams } from "./rules/no-multiple-function-params.ts"
import { noNodeChildProcess } from "./rules/no-node-child-process.ts"
import { noParseCoercion } from "./rules/no-parse-coercion.ts"
import { noRecordStringUndefined } from "./rules/no-record-string-undefined.ts"
import { noServiceOption } from "./rules/no-service-option.ts"
import { noSilentErrorSwallow } from "./rules/no-silent-error-swallow.ts"
import { noSwitch } from "./rules/no-switch.ts"
import { noSyncSchemaApis } from "./rules/no-sync-schema-apis.ts"
import { noTryCatch } from "./rules/no-try-catch.ts"
import { noTypeAssertion } from "./rules/no-type-assertion.ts"
import { noTypeofObject } from "./rules/no-typeof-object.ts"
import { noYieldlessEffectGen } from "./rules/no-yieldless-effect-gen.ts"
import { privateFunctionPrefix } from "./rules/private-function-prefix.ts"
import type { Plugin } from "./types.ts"

const plugin: Plugin = {
  meta: { name: "app" },
  rules: {
    "no-ambient-nondeterminism": noAmbientNondeterminism,
    "no-any": noAny,
    "no-banned-type-assertions": noBannedTypeAssertions,
    "no-bare-error": noBareError,
    "no-comments": noComments,
    "no-effect-asvoid": noEffectAsVoid,
    "no-multiple-function-params": noMultipleFunctionParams,
    "no-node-child-process": noNodeChildProcess,
    "no-parse-coercion": noParseCoercion,
    "no-record-string-undefined": noRecordStringUndefined,
    "no-service-option": noServiceOption,
    "no-silent-error-swallow": noSilentErrorSwallow,
    "no-switch": noSwitch,
    "no-sync-schema-apis": noSyncSchemaApis,
    "no-try-catch": noTryCatch,
    "no-type-assertion": noTypeAssertion,
    "no-typeof-object": noTypeofObject,
    "no-yieldless-effect-gen": noYieldlessEffectGen,
    "private-function-prefix": privateFunctionPrefix
  }
}

export default plugin
