import type { AstNode, Rule } from "../types.ts";

interface _Loose {
	readonly type?: string;
	readonly generator?: boolean;
	readonly body?: _Loose;
	readonly callee?: _Loose;
	readonly object?: _Loose;
	readonly property?: _Loose;
	readonly arguments?: ReadonlyArray<_Loose>;
	readonly name?: string;
}

function _loose(node: AstNode): _Loose {
	return node as _Loose;
}

function _isEffectGenCallee(callee: _Loose): boolean {
	if (callee.type !== "MemberExpression") return false;
	const object = callee.object;
	const property = callee.property;
	if (!object || !property) return false;
	if (object.type !== "Identifier") return false;
	if (property.type !== "Identifier") return false;
	if (object.name !== "Effect") return false;
	if (property.name !== "gen") return false;
	return true;
}

function _hasYieldExpression(node: _Loose): boolean {
	if (node.type === "YieldExpression") return true;
	const stack: Array<_Loose> = [node];
	while (stack.length > 0) {
		const cur = stack.pop();
		if (!cur) continue;
		if (cur.type === "YieldExpression") return true;
		for (const key of Object.keys(cur)) {
			if (key === "type" || key === "parent" || key === "loc" || key === "range") continue;
			const v = (cur as Record<string, unknown>)[key];
			if (Array.isArray(v)) {
				for (const item of v) {
					if (item && typeof item === "object" && "type" in item) {
						stack.push(item as _Loose);
					}
				}
			} else if (v && typeof v === "object" && "type" in v) {
				stack.push(v as _Loose);
			}
		}
	}
	return false;
}

export const noYieldlessEffectGen: Rule = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Forbid `Effect.gen(function*() { ... })` whose body has no `yield*` — use a plain expression with `Effect.succeed`/`Effect.sync`, or (for `Application.define({ build })`) a thunk.",
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const loose = _loose(node);
				const callee = loose.callee;
				if (!callee) return;
				if (!_isEffectGenCallee(callee)) return;
				const args = loose.arguments ?? [];
				const fn = args[0];
				if (!fn) return;
				if (fn.type !== "FunctionExpression" && fn.type !== "FunctionDeclaration") return;
				if (fn.generator !== true) return;
				const body = fn.body;
				if (!body) return;
				if (_hasYieldExpression(body)) return;
				context.report({
					node: callee as AstNode,
					message:
						"`Effect.gen(function*() { ... })` has no `yield*` — use `Effect.succeed(value)` (sync return), `Effect.sync(() => ...)`, or a thunk `() => value` if the consumer accepts one (e.g. `Application.define({ build })`).",
				});
			},
		};
	},
};
