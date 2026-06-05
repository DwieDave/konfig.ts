import { noBannedTypeAssertions } from "./rules/no-banned-type-assertions.ts";
import { noComments } from "./rules/no-comments.ts";
import { noMultipleFunctionParams } from "./rules/no-multiple-function-params.ts";
import { noSwitch } from "./rules/no-switch.ts";
import { noSyncSchemaApis } from "./rules/no-sync-schema-apis.ts";
import { noTypeAssertion } from "./rules/no-type-assertion.ts";
import { noYieldlessEffectGen } from "./rules/no-yieldless-effect-gen.ts";
import { privateFunctionPrefix } from "./rules/private-function-prefix.ts";
import type { Plugin } from "./types.ts";

const plugin: Plugin = {
	meta: { name: "app" },
	rules: {
		"no-banned-type-assertions": noBannedTypeAssertions,
		"no-comments": noComments,
		"no-multiple-function-params": noMultipleFunctionParams,
		"no-switch": noSwitch,
		"no-sync-schema-apis": noSyncSchemaApis,
		"no-type-assertion": noTypeAssertion,
		"no-yieldless-effect-gen": noYieldlessEffectGen,
		"private-function-prefix": privateFunctionPrefix,
	},
};

export default plugin;
