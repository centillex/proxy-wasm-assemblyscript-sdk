# Compatibility and qualification boundaries

## Preview matrix

| Component | Baseline |
|---|---|
| Upstream SDK | Kong v0.0.6, a1b7648399f18e709507bc07c59d0d34f08f39cb |
| Compiler | AssemblyScript 0.27.32; dependencies locked in package-lock.json |
| AssemblyScript runtime | incremental; not stub |
| Guest ABI | Proxy-Wasm 0.2.1 |
| Primary native host | ngx_wasm_module 3bed27836bb402143c6cbde17994b1d11a1084bc |
| Native runtime | Wasmtime 50.0.0, via the explicitly experimental static Nautiq host |
| Integration executable | SHA256 6bb69c53ec06044db5721acacf2d3c29440a89ba65cf9abf035f01276202ecaa |
| Isolation | explicit `proxy_wasm_isolation filter;` |

The native host is an external test prerequisite, not distributed in the SDK
package. That host used a hash-pinned upstream musl Wasmtime archive; these SDK
tests do not establish source-built runtime provenance or redistribution rights.

## What is exercised

Package tests install the actual packed artifact in a separate offline consumer.
They check default/nonempty/Unicode header configuration, empty reconfiguration,
independent VM configuration, 128 stream lifecycles, sequential root teardown,
deleted-context lookup, actual AssemblyScript assertion and unreachable traps,
and repeatable bytecode generation. The V8 ABI host is intentionally a component
fixture, not evidence of HTTP transport or Wasmtime compatibility.

The separate native suite checks real HTTPS H1 and H2, real Chrome H3 without
accepting H2 fallback, two independently configured filters in order, a verified
HTTPS origin, rejected wrong-origin identity, guest assertion/unreachable failure
without origin dispatch, 32 healthy requests afterward, request-context deletion
after disconnect, a WebSocket upgrade plus frame echo/normal close, and joined
worker shutdown. Native H3 uses an ephemeral fixture certificate's SPKI pin; it
does not claim publicly trusted certificates or Alt-Svc discovery qualification.

## Important limits

The SDK still keeps one root object per VM. Shared-VM multiple-root use can alias
configuration and is not supported by this preview's qualification. Per-filter
isolation is required for the tested host. ngx_wasm_module also initializes
filters in a shared bootstrap VM before serving; rejecting every additional
root ID breaks host startup even with filter isolation. The fork therefore does
not introduce that incompatible guard or claim that multi-root use is prevented.
The root-teardown regression covers the single-root lifecycle, not general
multi-root ownership.

The runtime source includes callouts, properties, shared state and other APIs
inherited from upstream. Those APIs are not newly qualified by a header/lifecycle
test, and the SDK is not a host capability boundary. No fuel limits, memory
quotas, L4 support, gRPC behavior, body-processing matrix, shared-VM isolation,
other AssemblyScript compiler/runtime versions, or Envoy/other-host portability
is claimed. WebSocket testing verifies HTTP upgrade and opaque frame forwarding,
not guest-level inspection of WebSocket messages.

Nautiq's existing deployed header module remains a different, specifically
approved artifact. Rebuilding with this package requires separate guest-hash
approval and rollout; there is no automatic migration.
