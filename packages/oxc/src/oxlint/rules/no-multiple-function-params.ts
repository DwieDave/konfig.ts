import type { AstNode, Rule } from "../types.ts";

const MESSAGE =
	"Functions with more than one parameter must take a single object parameter (named-args).";

function _check(context: Parameters<Rule["create"]>[0], node: AstNode) {
	const params = node.params as readonly AstNode[] | undefined;
	if (!params || params.length <= 1) return;
	context.report({ node, message: MESSAGE });
}

export const noMultipleFunctionParams: Rule = {
	meta: {
		type: "problem",
		docs: { description: "Multi-arg functions must accept a single object parameter." },
	},
	create(context) {
		return {
			FunctionDeclaration(node) {
				_check(context, node);
			},
			FunctionExpression(node) {
				_check(context, node);
			},
			ArrowFunctionExpression(node) {
				_check(context, node);
			},
			TSDeclareFunction(node) {
				_check(context, node);
			},
			TSFunctionType(node) {
				_check(context, node);
			},
		};
	},
};
