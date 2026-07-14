// Effect's `unstable/*` namespace can break between betas. Every file in
// this package that needs ChildProcess / ChildProcessSpawner imports them
// from here — when the upstream layout changes, we update one file.
//
// See compat.md at repo root for the unstable surface we depend on.
export { ChildProcess } from "effect/unstable/process"
export {
  ChildProcessSpawner,
  type ChildProcessSpawner as ChildProcessSpawnerType
} from "effect/unstable/process/ChildProcessSpawner"
