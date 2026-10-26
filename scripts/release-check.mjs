import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, fingerprint, hashFile, pack, run } from './common.mjs';

const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
assert.equal(manifest.name, '@centillex/proxy-wasm-sdk');
assert.equal(manifest.publishConfig.tag, 'next');
assert.equal(manifest.publishConfig.access, 'public');
assert(/^0\.1\.0-alpha\.[1-9][0-9]*$/.test(manifest.version), 'Review release gates before changing the preview version policy');
assert.equal(run('git', ['status', '--porcelain']).trim(), '', 'Commit the reviewed source before publishing');
const pkg = JSON.parse(readFileSync(join(root, 'build/package-tests.json')));
const native = JSON.parse(readFileSync(join(root, 'build/native-tests.json')));
const source = fingerprint();
for (const report of [pkg, native]) {
  assert.equal(report.passed, true);
  assert.equal(report.sourceSHA256, source, 'Stale qualification: run both suites on this exact tree');
  assert.equal(report.packageSHA256, pkg.packageSHA256);
}
assert.equal(pkg.version, manifest.version);
assert.equal(pkg.cases.length, 11);
assert.equal(native.cases.length, 9);
assert(native.staticELF);
assert.deepEqual(native.modules, pkg.modules);
for (const name of ['header', 'lifecycle']) assert.equal(hashFile(join(root, 'build', name + '.wasm')), pkg.modules[name]);
assert.equal(hashFile(join(root, 'build', pkg.tarball)), pkg.packageSHA256);
const temp = mkdtempSync(join(tmpdir(), 'centillex-release-'));
try {
  const fresh = pack(temp);
  assert.equal(hashFile(fresh.path), pkg.packageSHA256, 'The publishable package differs from the tested tarball');
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(JSON.stringify({ ready: true, version: manifest.version, tag: 'next', sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(), packageSHA256: pkg.packageSHA256, scope: 'Local qualification gate, not signed release authentication. npm authentication is separate.' }, null, 2));
