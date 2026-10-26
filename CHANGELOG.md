# Changelog

## 0.1.0-alpha.1 — Centillex preview

Baseline: Kong v0.0.6, `a1b7648399f18e709507bc07c59d0d34f08f39cb`.

- Rename package/repository metadata to the Centillex scope; retain original
  author, Apache-2.0 license and upstream ancestry.
- Replace nonexistent generated-JavaScript exports with real AssemblyScript
  source entry points and a `/proxy` wrapper, verified from an npm tarball.
- Pin AssemblyScript 0.27.32 and the incremental runtime. Remove obsolete
  development web-server/documentation dependencies from the active root build.
- Fix root-context `onDone`/`onDelete` lookup and clear the single root on deletion
  so sequential root lifecycles work. Previously root teardown searched only the
  stream-context map and trapped. This does not implement shared multi-root VMs.
- Clear the previous configuration on a zero-length reconfiguration; previously
  the old value was retained.
- Add reproducible packed-consumer tests, actual Wasm component lifecycles and
  SDK-specific assertion/trap tests, plus native loopback H1/H2/H3, independently
  verified HTTPS origin, two-filter ordering, client-disconnect cleanup,
  WebSocket handshake/echo/close and worker-shutdown tests.
- Add read-only package CI, weekly upstream/advisory review issues and Dependabot.
  Remove the inherited automatic release-to-npm workflow. Publication is a
  separate authenticated operation, gated by fresh local native qualification.

Npm publication status is separate from the GitHub preview. No arbitrary-plugin
security, universal Proxy-Wasm portability or production-hardening claim is made.
