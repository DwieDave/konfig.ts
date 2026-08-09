import type { AstNode, Comment, ReportDescriptor, Rule, RuleContext, SourceCode } from "../types.ts"

export interface Harness {
  readonly reports: ReportDescriptor[]
  readonly context: RuleContext
}

export interface HarnessOptions {
  readonly comments?: readonly Comment[]
  readonly options?: readonly unknown[]
}

// Mirrors the real getAncestors contract: strict ancestors only, nearest first is not
// guaranteed by callers here — rules just check membership/order from root to node.
function _getAncestors(node: AstNode): readonly AstNode[] {
  const ancestors: AstNode[] = []
  let cur = node.parent
  while (cur) {
    ancestors.unshift(cur)
    cur = cur.parent
  }
  return ancestors
}

export function createHarness(input?: HarnessOptions): Harness {
  const reports: ReportDescriptor[] = []
  const sourceCode: SourceCode = {
    text: "",
    getAllComments: () => input?.comments ?? [],
    getText: () => "",
    getAncestors: _getAncestors
  }
  const context: RuleContext = {
    id: "test",
    filename: "test.ts",
    sourceCode,
    options: input?.options ?? [],
    report: (descriptor) => reports.push(descriptor)
  }
  return { reports, context }
}

export interface RunVisitorInput {
  readonly rule: Rule
  readonly event: string
  readonly node: AstNode
  readonly harness?: Harness
}

/** Runs a single visitor event of `rule` against `node`, returning the reports it produced. */
export function runVisitor(input: RunVisitorInput): Harness {
  const harness = input.harness ?? createHarness()
  const listener = input.rule.create(harness.context)
  const fn = listener[input.event]
  if (!fn) throw new Error(`rule has no listener for "${input.event}"`)
  fn(input.node)
  return harness
}
