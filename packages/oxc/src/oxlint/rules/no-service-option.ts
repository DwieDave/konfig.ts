import { bannedEffectMember } from "../effect-member-rule.ts"

export const noServiceOption = bannedEffectMember({
  member: "serviceOption",
  description:
    "Avoid Effect.serviceOption. Require the service directly and provide it in the layer so missing dependencies fail at composition time.",
  message: "Do not use Effect.serviceOption. Require the service directly and provide it in the layer."
})
