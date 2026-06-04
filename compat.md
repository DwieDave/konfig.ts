# Compatibility — Effect unstable surface

konfig.ts depends on Effect 4 modules that are still under `effect/unstable/*`.
These can change between betas. To insulate the rest of the codebase, every
package that uses them re-exports the symbols it needs from a single
`_unstable.ts` file:

- `packages/core/src/_unstable.ts`
- `packages/env/src/_unstable.ts`
- `packages/sops/src/_unstable.ts`
- `packages/sealed-secrets/src/_unstable.ts`
- `packages/cli/src/_unstable.ts`

When upstream renames or moves a module, the only change required is in the
facade.

## Unstable surface we depend on

| Path | Used for | Risk |
|---|---|---|
| `effect/unstable/process` (`ChildProcess`) | constructing argv commands for sops/kubeseal/helm | Low — the shape `ChildProcess.make(cmd, args, opts)` has been stable for several betas. |
| `effect/unstable/process/ChildProcessSpawner` | spawning processes from Effect (Context.Tag + service interface) | Medium — the service interface (`spawn`, `string`, `exitCode`, `lines`, `streamString`, `streamLines`) is what test fixtures stub. A change here cascades into every test that mocks the spawner. |
| `effect/unstable/cli` (`Command`, `Flag`, `Argument`) | every `konfig <subcommand>` entrypoint | Medium — large API surface, evolving. The whole user-facing CLI sits on top of this. |

## Catalog pin

The root `package.json` catalog pins `effect` and `@effect/platform-node` to
exact beta versions (no `^`). Bumping is intentional: read the changelog,
update the facade if needed, run `bun run check && bun run test`.

## What to do when a beta bump breaks compilation

1. Re-read the failing import path against `references/effect-smol/packages/effect/src/...`.
2. Update the facade file (`_unstable.ts`) in the affected package(s).
3. If the service interface changed shape, update test fixtures
   (`_makeStubSpawner` in `packages/sops/src/backend.test.ts` and friends).
4. Document the change in this file under "## Notes" so the next reader has
   precedent.

## Notes

- 2026-06-04 — initial facade introduced; nothing in the codebase imports
  from `effect/unstable/*` outside of the `_unstable.ts` facades and the
  test fixtures that stub `ChildProcessSpawner`.
