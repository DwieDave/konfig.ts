import { Config } from "effect"
import { _makeEntry, type EntryMarker, type EnvClaim, type HasEnvClaims } from "./entry"

export interface DownwardEntry<EnvName extends string>
  extends Config.Config<string>, EntryMarker<"Downward">, HasEnvClaims
{
  readonly envName: EnvName
  readonly fieldPath: string
}

export interface DefineDownwardInput<EnvName extends string> {
  readonly envName: EnvName
  readonly fieldPath: string
}

const _define = <const EnvName extends string>(
  input: DefineDownwardInput<EnvName>
): DownwardEntry<EnvName> => {
  const parser = Config.string(input.envName)

  const envClaims: ReadonlyArray<EnvClaim> = [
    { envName: input.envName, label: `Downward(${input.envName})` }
  ]

  return _makeEntry({
    config: parser,
    metadata: {
      _kind: "Downward" as const,
      envName: input.envName,
      fieldPath: input.fieldPath,
      envClaims
    }
  })
}

export type AnyDownwardEntry = DownwardEntry<string>

/**
 * `Downward` value namespace.
 *
 *   const podName = Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" });
 */
export const Downward = {
  define: _define
}
