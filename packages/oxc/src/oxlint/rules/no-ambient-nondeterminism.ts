import { isIdentifier, isMemberExpression } from "../types.ts"
import type { AstNode, Rule } from "../types.ts"

function _memberParts(node: AstNode): { object: string; property: string } | null {
  if (!isMemberExpression(node)) return null
  if (!isIdentifier(node.object) || !isIdentifier(node.property)) return null
  return { object: node.object.name, property: node.property.name }
}

export const noAmbientNondeterminism: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow ambient randomness and time (Math.random, Date.now, new Date()) — use Effect's Random/Clock capabilities so the effect is deterministic and testable."
    }
  },
  create(context) {
    return {
      MemberExpression(node: AstNode) {
        const m = _memberParts(node)
        if (m === null) return
        if (m.object === "Math" && m.property === "random") {
          context.report({ node, message: "Do not use ambient Math.random. Use Effect's Random capability instead." })
          return
        }
        if (m.object === "Date" && m.property === "now") {
          context.report({ node, message: "Do not use ambient Date.now. Use Effect's Clock capability instead." })
        }
      },
      NewExpression(node: AstNode) {
        const callee = node.callee
        if (typeof callee !== "object" || callee === null) return
        const c = callee as AstNode
        if (!isIdentifier(c) || c.name !== "Date") return
        const args = node.arguments
        if (Array.isArray(args) && args.length === 0) {
          context.report({ node, message: "Do not construct an ambient Date for the current time. Use Effect's Clock/DateTime capability instead." })
        }
      }
    }
  }
}
