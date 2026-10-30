import { bannedEffectMember } from "../effect-member-rule.ts"

export const noEffectAsVoid = bannedEffectMember({
  member: "asVoid",
  description: "Avoid Effect.asVoid. Return the effect directly when its success type is already void.",
  message: "Avoid Effect.asVoid. Return the effect directly when its success type is already void."
})
