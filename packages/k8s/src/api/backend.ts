import type * as Kit from "../backendKit"
import { encryptingBackend, plainSecret, SecretBackend, secretMeta } from "../backendKit"

export const Backend = {
  define: SecretBackend.define,
  encrypting: encryptingBackend,
  plainSecret,
  secretMeta
}

export declare namespace Backend {
  type BaseInput<N extends string, K extends string, RequiresSource extends boolean = boolean> = Kit.BackendEmitInput<
    N,
    K,
    RequiresSource
  >

  type EmitInput<N extends string, K extends string, Opts, RS extends boolean = true> = Kit.EmitInput<N, K, Opts, RS>

  type CliOptions = Kit.CliBackendOptions
}
