
export interface SourceLocation {
	readonly line: number;
	readonly column: number;
}

export interface AstNode {
	readonly type: string;
	readonly loc?: { start: SourceLocation; end: SourceLocation };
	readonly parent?: AstNode;
	readonly [key: string]: unknown;
}

export interface Comment {
	readonly type: "Line" | "Block";
	readonly value: string;
	readonly loc?: { start: SourceLocation; end: SourceLocation };
}

export interface SourceCode {
	readonly text: string;
	getAllComments(): readonly Comment[];
	getText(node?: AstNode): string;
	getAncestors(node: AstNode): readonly AstNode[];
}

export interface ReportDescriptor {
	readonly node?: AstNode;
	readonly loc?: { start: SourceLocation; end: SourceLocation } | SourceLocation;
	readonly message: string;
	readonly messageId?: string;
	readonly data?: Readonly<Record<string, string>>;
}

export interface RuleContext {
	readonly id: string;
	readonly filename: string;
	readonly sourceCode: SourceCode;
	readonly options: readonly unknown[];
	report(descriptor: ReportDescriptor): void;
}

export type Visitor = (node: AstNode) => void;

export type RuleListener = Readonly<Record<string, Visitor>>;

export interface RuleMeta {
	readonly type?: "problem" | "suggestion" | "layout";
	readonly docs?: { readonly description?: string };
	readonly schema?: ReadonlyArray<unknown>;
}

export interface Rule {
	readonly meta?: RuleMeta;
	create(context: RuleContext): RuleListener;
}

export interface Plugin {
	readonly meta: { readonly name: string };
	readonly rules: Readonly<Record<string, Rule>>;
}
