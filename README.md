# Centillex Proxy-Wasm SDK for AssemblyScript

[![Packed SDK tests](https://github.com/centillex/proxy-wasm-assemblyscript-sdk/actions/workflows/pr.yml/badge.svg)](https://github.com/centillex/proxy-wasm-assemblyscript-sdk/actions/workflows/pr.yml)

`@centillex/proxy-wasm-sdk` is a maintained downstream fork of
[Kong's AssemblyScript SDK](https://github.com/Kong/proxy-wasm-assemblyscript-sdk),
starting at **v0.0.6 / a1b7648399f18e709507bc07c59d0d34f08f39cb**. Kong's SDK is
itself derived from Solo.io's proxy-runtime. Original attribution and Apache-2.0
licensing are retained; see [NOTICE](NOTICE) and [UPSTREAM.json](UPSTREAM.json).

The first preview is **0.1.0-alpha.1**, intended for npm's **`next`** tag, not
`latest`. Source/packed previews and npm publication are separate: npm publishing
requires a maintainer's registry access and the native release gate below.
Do not assume that a GitHub tag means the npm package has been published.

## Supported starting point

- AssemblyScript **0.27.32**, **incremental** runtime, Proxy-Wasm ABI **0.2.1**.
- Public source imports `@centillex/proxy-wasm-sdk` and
  `@centillex/proxy-wasm-sdk/proxy` work from the actual packed npm artifact.
- Primary integration: NGINX `ngx_wasm_module` with Wasmtime, tested using
  Nautiq's static musl native host. Use **`proxy_wasm_isolation filter;`**.
- Shared-VM multiple roots, other compiler/runtime combinations, Envoy and other
  hosts are **not qualified** by this preview. See the precise
  [compatibility and test boundaries](docs/compatibility.md).

This is AssemblyScript source for compiling Wasm guests, **not a Node.js/ordinary
JavaScript runtime package**. Arbitrary npm libraries do not become guest-compatible.

## Build a consumer

While npm publication is pending, install the packed preview from a local build
or the GitHub prerelease asset. Build the package with Node 22.22.0 and npm 11:

```sh
npm ci --ignore-scripts
npm test
# In a separate consumer project, with the path to this checkout's tarball:
npm install --save-exact /path/to/build/centillex-proxy-wasm-sdk-0.1.0-alpha.1.tgz
npm install --save-dev --save-exact assemblyscript@0.27.32
```

After registry publication, the equivalent pinned dependency is
`@centillex/proxy-wasm-sdk@0.1.0-alpha.1`. Commit the consumer's lockfile as well.

In `assembly/index.ts`:

```ts
export * from "@centillex/proxy-wasm-sdk/proxy";
import {
  Context, RootContext, registerRootContext, stream_context,
  FilterHeadersStatusValues
} from "@centillex/proxy-wasm-sdk";

class HeaderRoot extends RootContext {
  createContext(id: u32): Context { return new HeaderFilter(id, this); }
}
class HeaderFilter extends Context {
  onResponseHeaders(count: u32, end: bool): FilterHeadersStatusValues {
    stream_context.headers.response.add("x-centillex-wasm", "hello");
    return FilterHeadersStatusValues.Continue;
  }
}
registerRootContext((id: u32): RootContext => new HeaderRoot(id), "header");
```

Compile with your locally installed compiler:

```sh
./node_modules/.bin/asc assembly/index.ts --outFile build/header.wasm \
  --optimize --runtime incremental --use abort=abort_proc_exit
```

A configurable version is in [examples/header-filter.ts](examples/header-filter.ts).
The older example directories are retained upstream reference material; they
are not updated/qualified Centillex installation instructions or CI gates.

## Testing

```sh
npm ci --ignore-scripts
npm test

# Explicit existing executables; this does not download a host or touch a server.
NGINX_BINARY=/absolute/path/to/static-wasm-nginx \
OPENSSL_BINARY=/absolute/path/to/openssl \
CHROME_BINARY=/absolute/path/to/google-chrome \
  npm run test:native
```

`npm test` packs and installs into a fresh offline consumer, compiles the actual
package, and exercises real Wasm via a small V8 ABI fixture. Native tests never
silently skip: they require the three explicit executables, non-root sandboxed
Chrome, and a static NGINX host with Wasmtime, HTTP/2 and HTTP/3 enabled. They run
only on ephemeral loopback ports, with an ephemeral certificate (Chrome uses its
SPKI pin) and a verified HTTPS origin. No host trust or public deployment changes.

Ignored `build/package-tests.json` and `build/native-tests.json` bind results to
the source tree, packed package, guest modules and native executable hashes.
Normal GitHub PR CI runs the package/component suite only; native qualification
is an explicit maintainer-side release gate, not inferred from a green CI badge.

## Maintenance and releases

See [MAINTAINING.md](MAINTAINING.md), [SECURITY.md](SECURITY.md), and
[CHANGELOG.md](CHANGELOG.md). Weekly workflows monitor the SDK, host, ABI spec,
AssemblyScript, Wasmtime and public repository advisories. Dependabot proposes
npm/GitHub Actions updates; nothing is automatically merged or published.

Changing an SDK or compiler can change guest bytes. A hash-pinned deployment
must explicitly approve and qualify the rebuilt guest. Creating this fork does
**not** upgrade Nautiq's running demo or its approved module hash.
