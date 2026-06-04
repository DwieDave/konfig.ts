import type { AstNode, Rule } from "../types.ts";

const MESSAGE =
	"Functions with more than one parameter must take a single object parameter (named-args).";

type Scope = "all" | "exports";

const _isInsideExport = (context: Parameters<Rule["create"]>[0], node: AstNode): boolean => {
	for (const ancestor of context.sourceCode.getAncestors(node)) {
		const t = ancestor.type;
		if (
			t === "ExportNamedDeclaration" ||
			t === "ExportDefaultDeclaration" ||
			t === "ExportAllDeclaration"
		) {
			return true;
		}
	}
	return false;
};

const _scopeFrom = (context: Parameters<Rule["create"]>[0]): Scope => {
	const opt = context.options[0];
	if (opt && typeof opt === "object" && "scope" in opt) {
		const scope = (opt as { scope?: unknown }).scope;
		if (scope === "all" || scope === "exports") return scope;
	}
	return "exports";
};

function _check(context: Parameters<Rule["create"]>[0], node: AstNode, scope: Scope) {
	const params = node.params as readonly AstNode[] | undefined;
	if (!params || params.length <= 1) return;
	if (scope === "exports" && !_isInsideExport(context, node)) return;
	context.report({ node, message: MESSAGE });
}

export const noMultipleFunctionParams: Rule = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Multi-arg functions must accept a single object parameter. Default scope: 'exports' — internal helpers may take positional args.",
		},
		schema: [
			{
				type: "object",
				properties: {
					scope: { enum: ["all", "exports"] },
				},
				additionalProperties: false,
			},
		],
	},
	create(context) {
		const scope = _scopeFrom(context);
		return {
			FunctionDeclaration(node) {
				_check(context, node, scope);
			},
			FunctionExpression(node) {
				_check(context, node, scope);
			},
			ArrowFunctionExpression(node) {
				_check(context, node, scope);
			},
			TSDeclareFunction(node) {
				_check(context, node, scope);
			},
			TSFunctionType(node) {
				_check(context, node, scope);
			},
		};
	},
};
