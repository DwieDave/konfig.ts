export interface SourceLocation {
  readonly line: number
  readonly column: number
}

export interface AstNode {
  readonly type: string
  readonly loc?: { start: SourceLocation; end: SourceLocation }
  readonly parent?: AstNode
  readonly [key: string]: unknown
}

export interface Identifier extends AstNode {
  readonly type: "Identifier"
  readonly name: string
}

export interface MemberExpression extends AstNode {
  readonly type: "MemberExpression"
  readonly object: AstNode
  readonly property: AstNode
}

export interface CallExpression extends AstNode {
  readonly type: "CallExpression"
  readonly callee: AstNode
  readonly arguments: readonly AstNode[]
}

export interface FunctionLike extends AstNode {
  readonly type: "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression"
  readonly id?: AstNode
  readonly params: readonly AstNode[]
  readonly body?: AstNode
  readonly generator?: boolean
}

export interface VariableDeclarator extends AstNode {
  readonly type: "VariableDeclarator"
  readonly id: AstNode
  readonly init?: AstNode
}

export interface VariableDeclaration extends AstNode {
  readonly type: "VariableDeclaration"
  readonly declarations: readonly VariableDeclarator[]
}

export interface TSTypeReference extends AstNode {
  readonly type: "TSTypeReference"
  readonly typeName: AstNode
}

export interface TSTypeCast extends AstNode {
  readonly type: "TSAsExpression" | "TSTypeAssertion"
  readonly expression: AstNode
  readonly typeAnnotation: AstNode
}

export const isIdentifier = (node: AstNode): node is Identifier => node.type === "Identifier"

export const isMemberExpression = (node: AstNode): node is MemberExpression =>
  node.type === "MemberExpression"

export const isCallExpression = (node: AstNode): node is CallExpression =>
  node.type === "CallExpression"

export const isFunctionLike = (node: AstNode): node is FunctionLike =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression"

export const isVariableDeclaration = (node: AstNode): node is VariableDeclaration =>
  node.type === "VariableDeclaration"

export const isVariableDeclarator = (node: AstNode): node is VariableDeclarator =>
  node.type === "VariableDeclarator"

export const isTSTypeReference = (node: AstNode): node is TSTypeReference =>
  node.type === "TSTypeReference"

export const isTSTypeCast = (node: AstNode): node is TSTypeCast =>
  node.type === "TSAsExpression" || node.type === "TSTypeAssertion"

export interface Comment {
  readonly type: "Line" | "Block"
  readonly value: string
  readonly loc?: { start: SourceLocation; end: SourceLocation }
}

export interface SourceCode {
  readonly text: string
  getAllComments(): readonly Comment[]
  getText(node?: AstNode): string
  getAncestors(node: AstNode): readonly AstNode[]
}

export interface ReportDescriptor {
  readonly node?: AstNode
  readonly loc?: { start: SourceLocation; end: SourceLocation } | SourceLocation
  readonly message: string
  readonly messageId?: string
  readonly data?: Readonly<Record<string, string>>
}

export interface RuleContext {
  readonly id: string
  readonly filename: string
  readonly sourceCode: SourceCode
  readonly options: readonly unknown[]
  report(descriptor: ReportDescriptor): void
}

export type Visitor = (node: AstNode) => void

export type RuleListener = Readonly<Record<string, Visitor>>

export interface RuleMeta {
  readonly type?: "problem" | "suggestion" | "layout"
  readonly docs?: { readonly description?: string }
  readonly schema?: ReadonlyArray<unknown>
}

export interface Rule {
  readonly meta?: RuleMeta
  create(context: RuleContext): RuleListener
}

export interface Plugin {
  readonly meta: { readonly name: string }
  readonly rules: Readonly<Record<string, Rule>>
}
