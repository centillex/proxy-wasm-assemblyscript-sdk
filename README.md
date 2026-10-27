# Centillex Proxy-Wasm SDK for AssemblyScript

[![Packed SDK tests](https://github.com/centillex/proxy-wasm-assemblyscript-sdk/actions/workflows/pr.yml/badge.svg)](https://github.com/centillex/proxy-wasm-assemblyscript-sdk/actions/workflows/pr.yml)

`@centillex/proxy-wasm-sdk` is a maintained downstream fork of
[Kong's AssemblyScript SDK](https://github.com/Kong/proxy-wasm-assemblyscript-sdk),
itself derived from Solo.io's proxy-runtime. This fork evolves as reviewed code
lands. Original attribution and Apache-2.0 licensing are retained; see
[NOTICE](NOTICE) and [UPSTREAM.json](UPSTREAM.json) for its provenance.

Preview packages use npm's **`next`** channel. See the
[releases](https://github.com/centillex/proxy-wasm-assemblyscript-sdk/releases) and
[CHANGELOG.md](CHANGELOG.md) for release-specific details. Source/packed previews
and npm publication are separate: npm publishing requires a maintainer's registry
access and the native release gate below. Do not assume that a GitHub tag means
the npm package has been published.

## Supported integration

- AssemblyScript with the **incremental** runtime and Proxy-Wasm ABI callbacks.
  The current package metadata declares the compiler requirements; the
  [compatibility matrix](docs/compatibility.md) records tested combinations.
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
or a GitHub prerelease asset. Use the toolchain requirements declared by the
current checkout:

```sh
npm ci --ignore-scripts
npm test
```

In a separate consumer project, install the generated or downloaded tarball
(replace the example path with the actual artifact path):

```sh
npm install /path/to/sdk-preview.tgz
```

After registry publication, install from the preview channel instead:

```sh
npm install @centillex/proxy-wasm-sdk@next
```

npm installs the SDK's declared AssemblyScript peer dependency. Use that compiler
when building your guest; check the compatibility documentation before upgrading
it independently.

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

Changing an SDK or compiler can change guest bytes. Deployments that approve
guest artifacts by hash must explicitly approve and qualify the rebuilt guest.
Updates to this repository do **not** automatically upgrade Nautiq's running demo
or its approved module hash.
