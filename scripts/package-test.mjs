import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run, pack, hashFile, fingerprint } from './common.mjs';

const output = join(root, 'build');
mkdirSync(output, { recursive: true });
rmSync(join(output, 'package-tests.json'), { force: true });
rmSync(join(output, 'native-tests.json'), { force: true });
const temp = mkdtempSync(join(tmpdir(), 'centillex-sdk-'));
const cases = [];
try {
  const { metadata, path } = pack(temp);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
  assert.equal(metadata.name, '@centillex/proxy-wasm-sdk');
  assert.equal(metadata.version, manifest.version);
  const files = metadata.files.map(f => f.path);
  for (const required of ['index.ts', 'proxy.ts', 'assembly/index.ts', 'assembly/proxy.ts', 'LICENSE.txt', 'NOTICE', 'UPSTREAM.json']) assert(files.includes(required), required);
  assert(!files.some(f => f.startsWith('build/') || f.startsWith('node_modules/') || f.endsWith('.wasm') || f === 'index.js'));
  cases.push('packed-source-entry-points-and-notices');
  const client = join(temp, 'consumer');
  mkdirSync(join(client, 'assembly'), { recursive: true });
  writeFileSync(join(client, 'package.json'), JSON.stringify({ name: 'sdk-consumer-test', private: true, version: '1.0.0', type: 'module' }));
  // No link to this repository's node_modules and no lifecycle scripts/network.
  run('npm', ['install', '--offline', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund', '--save-exact', path, 'assemblyscript@0.27.32'], client);
  const installed = JSON.parse(readFileSync(join(client, 'node_modules/@centillex/proxy-wasm-sdk/package.json')));
  assert.equal(installed.version, manifest.version);
  cases.push('fresh-offline-tarball-consumer');
  const modules = {};
  for (const [name, source] of [['header', 'examples/header-filter.ts'], ['lifecycle', 'tests/lifecycle.ts']]) {
    copyFileSync(join(root, source), join(client, 'assembly', name + '.ts'));
    const args = [join(client, 'node_modules/assemblyscript/bin/asc.js'), 'assembly/' + name + '.ts', '--outFile', name + '.wasm', '--optimize', '--runtime', 'incremental', '--use', 'abort=abort_proc_exit'];
    run(process.execPath, args, client);
    const first = readFileSync(join(client, name + '.wasm'));
    run(process.execPath, args, client);
    assert.deepEqual(readFileSync(join(client, name + '.wasm')), first);
    copyFileSync(join(client, name + '.wasm'), join(output, name + '.wasm'));
    modules[name] = hashFile(join(output, name + '.wasm'));
    cases.push(name + '-repeatable-compilation');
  }

  // Actual compiled Wasm in V8, with a deliberately small in-process ABI host.
  // This is component evidence, not NGINX/Wasmtime transport qualification.
  async function guest(name, configuration = '') {
    const module = await WebAssembly.compile(readFileSync(join(output, name + '.wasm')));
    let instance;
    const headers = [], logs = [];
    let config = Buffer.from(configuration);
    const text = (p, n) => Buffer.from(instance.exports.memory.buffer, p, n).toString('utf8');
    const writeBuffer = (bytes, pointer, length) => {
      const p = instance.exports.malloc(bytes.length);
      new Uint8Array(instance.exports.memory.buffer, p, bytes.length).set(bytes);
      const view = new DataView(instance.exports.memory.buffer);
      view.setUint32(pointer, p, true); view.setUint32(length, bytes.length, true);
    };
    const env = {
      proxy_set_effective_context() { throw new Error('Unexpected callout-context operation in header/lifecycle fixture'); },
      proxy_log(level, p, n) { logs.push({ level, text: text(p, n) }); return 0; },
      proxy_get_buffer_bytes(type, start, size, pointer, length) {
        assert.equal(type, 7); assert.equal(start, 0); assert.equal(size, config.length);
        writeBuffer(config, pointer, length); return 0;
      },
      proxy_add_header_map_value(type, kp, kn, vp, vn) {
        assert.equal(type, 2); headers.push([text(kp, kn), text(vp, vn)]); return 0;
      }
    };
    for (const i of WebAssembly.Module.imports(module)) assert(i.module === 'env' && typeof env[i.name] === 'function', 'Unexpected fixture import: ' + i.module + '.' + i.name);
    instance = await WebAssembly.instantiate(module, { env });
    const e = instance.exports;
    assert.equal(typeof e.proxy_abi_version_0_2_1, 'function');
    assert.equal(typeof e.proxy_on_context_create, 'function');
    e.proxy_on_context_create(1, 0);
    assert.equal(e.proxy_on_vm_start(1, 0), 1);
    assert.equal(e.proxy_on_configure(1, config.length), 1);
    return { e, headers, logs, configure(value) { config = Buffer.from(value); assert.equal(e.proxy_on_configure(1, config.length), 1); } };
  }
  for (const value of ['', 'configured', 'Unicode-λ']) {
    const g = await guest('header', value);
    g.e.proxy_on_context_create(2, 1);
    assert.equal(g.e.proxy_on_response_headers(2, 0, 1), 0);
    assert.deepEqual(g.headers, [['x-centillex-wasm', value || 'assemblyscript']]);
  }
  cases.push('default-configured-and-utf8-header-values');
  const a = await guest('header', 'first'), b = await guest('header', 'second');
  for (const g of [a, b]) { g.e.proxy_on_context_create(2, 1); g.e.proxy_on_response_headers(2, 0, 1); }
  assert.equal(a.headers[0][1], 'first'); assert.equal(b.headers[0][1], 'second');
  cases.push('independent-vm-configurations');
  a.configure(''); a.e.proxy_on_response_headers(2, 0, 1);
  assert.equal(a.headers[1][1], 'assemblyscript');
  cases.push('empty-reconfiguration-clears-old-value');
  const lifecycle = await guest('lifecycle');
  for (let id = 2; id < 130; id++) {
    lifecycle.e.proxy_on_context_create(id, 1);
    assert.equal(lifecycle.e.proxy_on_request_headers(id, 0, 1), 0);
    assert.equal(lifecycle.e.proxy_on_done(id), 1);
    lifecycle.e.proxy_on_log(id);
    lifecycle.e.proxy_on_delete(id);
  }
  for (const counter of ['createdCount', 'doneCount', 'deletedCount']) assert.equal(lifecycle.e[counter](), 128);
  assert.equal(lifecycle.e.proxy_on_done(1), 1);
  lifecycle.e.proxy_on_delete(1);
  assert.equal(lifecycle.e.rootsDoneCount(), 1);
  assert.equal(lifecycle.e.rootsDeletedCount(), 1);
  lifecycle.e.proxy_on_context_create(3, 0);
  assert.equal(lifecycle.e.proxy_on_vm_start(3, 0), 1);
  assert.equal(lifecycle.e.proxy_on_done(3), 1);
  lifecycle.e.proxy_on_delete(3);
  assert.equal(lifecycle.e.rootsDeletedCount(), 2);
  cases.push('128-stream-lifecycles-and-sequential-root-teardown');
  const dead = await guest('lifecycle');
  dead.e.proxy_on_context_create(2, 1); dead.e.proxy_on_delete(2);
  assert.throws(() => dead.e.proxy_on_done(2), WebAssembly.RuntimeError);
  cases.push('deleted-context-not-retained');
  for (const configuration of ['abort', 'trap']) {
    const g = await guest('lifecycle', configuration);
    g.e.proxy_on_context_create(2, 1);
    assert.throws(() => g.e.proxy_on_request_headers(2, 0, 1), WebAssembly.RuntimeError);
    if (configuration === 'abort') assert(g.logs.some(l => l.level === 5 && l.text.includes('intentional SDK assertion fixture')));
    cases.push('assemblyscript-' + configuration + '-traps');
  }
  copyFileSync(path, join(output, metadata.filename));
  const report = { passed: true, sourceSHA256: fingerprint(), version: manifest.version, tarball: metadata.filename,
    packageSHA256: hashFile(path), assemblyscript: '0.27.32', runtime: 'incremental', modules, cases,
    scope: 'Packed-artifact compiler and V8 ABI component tests; native transport qualification is separate.' };
  writeFileSync(join(output, 'package-tests.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { rmSync(temp, { recursive: true, force: true }); }
