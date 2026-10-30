import type { PackageInfo } from "./repo"

const _isReady = (
  input: { readonly pkg: PackageInfo; readonly done: ReadonlySet<string>; readonly known: ReadonlySet<string> }
) => [...input.pkg.deps].every((dep) => !input.known.has(dep) || input.done.has(dep))

const _step = (
  input: {
    readonly pending: ReadonlyArray<PackageInfo>
    readonly done: ReadonlyArray<PackageInfo>
    readonly known: ReadonlySet<string>
  }
) => {
  const doneNames = new Set(input.done.map((p) => p.name))
  const ready = input.pending.filter((pkg) => _isReady({ pkg, done: doneNames, known: input.known }))
  return ready.length === 0
    ? { pending: [], done: [...input.done, ...input.pending] }
    : { pending: input.pending.filter((p) => !ready.includes(p)), done: [...input.done, ...ready] }
}

const _walk = (
  input: {
    readonly pending: ReadonlyArray<PackageInfo>
    readonly done: ReadonlyArray<PackageInfo>
    readonly known: ReadonlySet<string>
  }
): ReadonlyArray<PackageInfo> =>
  input.pending.length === 0 ? input.done : _walk({ ..._step(input), known: input.known })

/** Dependencies first; siblings keep input order; a cycle falls back to input order for the remainder. */
export const topoOrder = (packages: ReadonlyArray<PackageInfo>): ReadonlyArray<PackageInfo> =>
  _walk({ pending: packages, done: [], known: new Set(packages.map((p) => p.name)) })
