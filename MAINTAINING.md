# Maintaining the Centillex fork

## Branches and provenance

`main` is the Centillex development branch, starting from Kong's exact v0.0.6
commit. The original Git history and upstream tags are preserved. `upstream`
should point to `https://github.com/Kong/proxy-wasm-assemblyscript-sdk.git`.
Never force-sync `main` to upstream master or silently rebase the recorded origin.
Use Centillex versions independently of Kong's sequence.

## Weekly review

`Upstream maintenance watch` runs Mondays at 03:19 UTC and is manually runnable.
It reads metadata only and opens/updates one bot-owned review-queue issue when
recorded baselines differ or public advisories require assessment. It never
fetches executable upstream code, merges changes, publishes packages or deploys.
The JSON artifact is retained 90 days. API errors fail the job rather than
reporting an empty/successful security check.

Review the SDK, ngx_wasm_module, Proxy-Wasm spec, AssemblyScript and Wasmtime.
Use `.github/upstreams.json` to record deliberately reviewed monitoring baselines;
keep `UPSTREAM.json` as the actual fork origin. A monitoring baseline update is
not an implementation or compatibility claim. The post-tag Kong commits were
not automatically adopted; they must be compared to this tagged baseline.

Dependabot submits weekly root npm and Actions updates. Do not auto-merge them.
Investigate relevant security notices immediately, and repeat the native matrix
at least monthly and before each preview release. Scheduled observation is not
a promise of unattended human maintenance.

## Preview release procedure

1. Review code, attribution, public package contents and changelog. Pin the exact
   compiler and all resolved dependencies. Do not add credentials or native host
   binaries to the package/repository.
2. Commit the reviewed source; require a clean tree and green packed-package CI.
3. Run `npm ci --ignore-scripts`, `npm test`, then the explicit native test command
   in README. Missing host/browser prerequisites are a blocker, never a skip.
4. Run `npm run release:check`. It requires fresh package/native receipts bound
   to this tree and compares a newly packed tarball to the tested artifact.
   Any subsequent source/doc/workflow change requires rerunning the tests.
5. Authenticate to npm **interactively**, outside chat/logs (`npm login`) and verify
   `npm whoami`. The account must be authorized to publish under `@centillex`.
   Prefer scoped/short-lived credentials or a separately configured npm trusted
   publisher; never commit or paste tokens. A successful GitHub login is not npm
   authorization.
6. Publish from the clean repository using `npm publish --access public --tag next`.
   Do not pass `--ignore-scripts`: `prepublishOnly` reruns the release gate. Retain
   the tested tarball and receipts. Verify the registry version, dist-tag and
   tarball integrity after publication. Do not move `latest` for this preview.
7. Create a GitHub prerelease on the exact tested commit. Attach the package and
   receipts but no native binaries/private fixture files. A source-only preview
   may precede npm publication, provided its release notes say so explicitly.

These are maintainer-side checks, not signed or independent attestations. There
is intentionally no automatic publishing workflow: the native host is an
explicit external prerequisite and npm access must be separately configured.
A green component CI badge alone cannot authorize publishing.

## Native test ownership

The fixture owns its temporary directory, loopback services, NGINX process group
and sandboxed Chrome process group. It cancels/joins them, and retains private
fixture diagnostics on failure without turning a failed exit into a pass.
Failure directories can include ephemeral test keys; do not upload them.
Qualification receipts contain hashes and case names, not keys or private paths.

Do not change the deployed Nautiq guest as part of an SDK release. Hash approval,
controller packaging, live regression checks and rollback are separate work.
