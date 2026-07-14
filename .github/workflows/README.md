# CI / release workflows

## `ci.yml` — on push and PR

Runs `bun run check` (typecheck every package), `bun run test` (every
test suite), and the full-stack example's typecheck. Lint is invoked
with `continue-on-error: true` until the M6.1 scope refactor settles
the pre-existing warnings.

## `release.yml` — on tag

Triggered by a `vX.Y.Z` tag. Runs:

1. **Verify tag → version match.** Every `packages/*/package.json` must
   declare the version that the tag names. konfig.ts uses lockstep
   versioning (see `.docs/versioning.md`), so this is one check
   repeated 9×.
2. **`bun run check` + `bun run test` + `bun run build`** — the same
   gates as CI, run on the tagged commit's tree.
3. **Rewrite `workspace:*` → exact version** via
   `scripts/rewrite-workspace-deps.cjs`. The npm registry doesn't
   understand `workspace:*`; the script pins every internal dep to the
   lockstep version.
4. **`npm pack --dry-run`** for each package — surfaces the
   to-be-published file list so a misconfigured `files` array gets
   caught before publish.
5. **`npm publish --access public --provenance`** in dep-graph order.
   `--provenance` attaches a Sigstore-signed attestation that the
   tarball was built from this exact GitHub repo + commit + workflow
   run.
6. **SLSA provenance attestations** via
   `actions/attest-build-provenance` for the dist outputs.
7. **Reproducibility verification** — a separate job downloads each
   just-published tarball and diffs its `dist/` against what was built
   locally. A mismatch fails the workflow.

## Secrets required

| Secret      | Used by       | Purpose                                             |
| ----------- | ------------- | --------------------------------------------------- |
| `NPM_TOKEN` | `release.yml` | npm "Publish" scope token for the `@konfig.ts` org. |

## Permissions

The release workflow requests `id-token: write` and `attestations:
write` — these are required for npm provenance and the GitHub
attestation action, respectively. The CI workflow needs only
`contents: read`.

## Tag signing

Tags should be created with `git tag -s vX.Y.Z` (GPG-signed) or
`git tag --sign-with` (SSH-signed). The release workflow does NOT
verify the tag signature — that check belongs on the protected branch
as a required status check, paired with `tag protection rules` on the
repo. The workflow assumes the tag has already passed that gate.

Recommended GitHub repo settings:

- Branch protection on `main`: require signed commits, require status
  checks (`ci.yml`), require linear history.
- Tag protection rules: pattern `v[0-9]+.[0-9]+.[0-9]+*`, require
  signed tags.

## Local dry-run

Before tagging, do a local pack pass:

```bash
bun install --frozen-lockfile
bun run check && bun run test && bun run build
node scripts/rewrite-workspace-deps.cjs
for pkg in packages/*/; do
  (cd "$pkg" && npm pack --dry-run --json) | jq '.[0].files | length'
done
# Inspect counts and the listed files. Restore the workspace deps:
git checkout packages/*/package.json
```
