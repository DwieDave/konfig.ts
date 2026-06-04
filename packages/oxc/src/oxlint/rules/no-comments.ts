import type { AstNode, Rule } from "../types.ts";

/**
 * Why a comment budget? Most comments rot — the code moves and the
 * comment stays. `app/no-comments` caps non-directive comments to N
 * per file at K chars each, forcing the alternatives: a clearer name,
 * a tighter function, or a docblock on the exported symbol.
 *
 * Exemptions:
 *  - Directives (`eslint`, `oxlint`, `biome`, `prettier`, `@ts-...`)
 *    are always passed through.
 *  - WHY comments tagged `// konfig: WHY <reason>` are passed through
 *    without counting against the budget — the prefix marks them as
 *    intentional rationale that future readers must NOT remove
 *    without understanding the "why".
 */
const DIRECTIVE_PREFIX = /^\s*(eslint|oxlint|biome|prettier|@ts-)/;
const WHY_PREFIX = /^\s*konfig:\s*WHY\b/;
const MAX_COMMENTS_PER_FILE = 3;
const MAX_COMMENT_LENGTH = 150;

export const noComments: Rule = {
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Comments are budget-limited: single-line only, < 150 chars, max 3 non-directive comments per file. `// konfig: WHY ...` is exempt.",
		},
	},
	create(context) {
		return {
			Program(node: AstNode) {
				let kept = 0;
				for (const comment of context.sourceCode.getAllComments()) {
					if (DIRECTIVE_PREFIX.test(comment.value)) continue;
					if (WHY_PREFIX.test(comment.value)) continue;
					if (comment.type === "Block") {
						context.report({
							loc: comment.loc,
							node,
							message:
								"Block comments are not allowed — use a `//` line comment instead, or `// konfig: WHY ...` for intentional rationale.",
						});
						continue;
					}
					if (comment.value.length > MAX_COMMENT_LENGTH) {
						context.report({
							loc: comment.loc,
							node,
							message: `Comment exceeds ${MAX_COMMENT_LENGTH} chars (${comment.value.length}). Split, shorten, or convert to a \`// konfig: WHY ...\` rationale comment.`,
						});
						continue;
					}
					kept++;
					if (kept > MAX_COMMENTS_PER_FILE) {
						context.report({
							loc: comment.loc,
							node,
							message: `Over the per-file comment budget (${MAX_COMMENTS_PER_FILE}). Remove, consolidate, or convert to a \`// konfig: WHY ...\` rationale comment.`,
						});
					}
				}
			},
		};
	},
};
