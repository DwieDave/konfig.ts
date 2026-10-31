export { Sops, type SopsBackendOptions } from "./backend"

export type { SopsRecipients, SopsSecret, SopsSecretSpec, SopsSecretTemplate } from "./schema"

export {
  sopsDecrypt,
  type SopsDecryptInput,
  sopsEncryptStdin,
  type SopsEncryptStdinInput,
  SopsInvocationError
} from "./sops"

export type { SopsSourceInput } from "./source"
