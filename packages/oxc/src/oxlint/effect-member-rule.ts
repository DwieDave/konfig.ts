import { defineRule } from "@oxlint/plugins"
import { Option } from "effect"
import { effectMemberName } from "./ast.ts"

export interface EffectMemberRuleInput {
  readonly member: string
  readonly description: string
  readonly message: string
}

export const bannedEffectMember = (input: EffectMemberRuleInput) =>
  defineRule({
    meta: { type: "problem", docs: { description: input.description } },
    create(context) {
      return {
        MemberExpression(node) {
          if (Option.exists(effectMemberName(node), (name) => name === input.member)) {
            context.report({ node, message: input.message })
          }
        }
      }
    }
  })
