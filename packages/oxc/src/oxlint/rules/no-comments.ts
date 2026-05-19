import type { AstNode, Rule } from "../types.ts";

const DIRECTIVE_PREFIX = /^\s*(eslint|oxlint|biome|prettier|@ts-)/;
const MAX_COMMENTS_PER_FILE = 3;
const MAX_COMMENT_LENGTH = 150;

export const noComments: Rule = {
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Comments are budget-limited: single-line only, < 150 chars, max 3 non-directive comments per file.",
		},
	},
	create(context) {
		return {
			Program(node: AstNode) {
				let kept = 0;
				for (const comment of context.sourceCode.getAllComments()) {
					if (DIRECTIVE_PREFIX.test(comment.value)) continue;
					if (comment.type === "Block") {
						context.report({
							loc: comment.loc,
							node,
							message: "Block comments are not allowed — use a `//` line comment instead.",
						});
						continue;
					}
					if (comment.value.length > MAX_COMMENT_LENGTH) {
						context.report({
							loc: comment.loc,
							node,
							message: `Comment exceeds ${MAX_COMMENT_LENGTH} chars (${comment.value.length}). Split or shorten.`,
						});
						continue;
					}
					kept++;
					if (kept > MAX_COMMENTS_PER_FILE) {
						context.report({
							loc: comment.loc,
							node,
							message: `Over the per-file comment budget (${MAX_COMMENTS_PER_FILE}). Remove or consolidate.`,
						});
					}
				}
			},
		};
	},
};
