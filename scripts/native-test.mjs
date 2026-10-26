// Owned loopback-only host integration. No live deployment or trust installation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import { X509Certificate } from 'node:crypto';
import { root, run, hashFile, fingerprint } from './common.mjs';

const output = join(root, 'build');
rmSync(join(output, 'native-tests.json'), { force: true });
const pkg = JSON.parse(readFileSync(join(output, 'package-tests.json')));
assert(pkg.passed && pkg.sourceSHA256 === fingerprint(), 'Run npm test on the current tree first');
const binaries = {};
for (const name of ['NGINX', 'OPENSSL', 'CHROME']) {
  assert(process.env[name + '_BINARY'], name + '_BINARY is required; native tests never silently skip');
  binaries[name] = resolve(process.env[name + '_BINARY']);
}
assert(process.getuid() !== 0, 'Chrome must run non-root with its sandbox');
const elf = run('readelf', ['-l', '-d', binaries.NGINX]);
assert(!/\(NEEDED\)|\bINTERP\b/.test(elf), 'This qualification requires the static native host');
for (const name of ['header', 'lifecycle']) assert.equal(hashFile(join(output, name + '.wasm')), pkg.modules[name]);
const temp = mkdtempSync(join(tmpdir(), 'centillex-native-'));
const cases = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const write = (name, bytes) => { const path = join(temp, name); writeFileSync(path, bytes, { mode: 0o600 }); return path; };
const owned = [];
function start(executable, args, name, env = process.env) {
  const fd = openSync(join(temp, name + '.log'), 'wx', 0o600);
  let p;
  try { p = spawn(executable, args, { env, detached: true, stdio: ['ignore', fd, fd] }); }
  finally { closeSync(fd); }
  const item = { p, name, done: new Promise((resolve, reject) => { p.once('exit', (code, signal) => resolve({ code, signal })); p.once('error', reject); }) };
  // Keep rejection handled until cleanup takes ownership.
  item.done.catch(() => {}); owned.push(item); return item;
}
async function stop(item) {
  if (item.stopped) return;
  if (item.p.exitCode === null && item.p.signalCode === null) process.kill(-item.p.pid, 'SIGTERM');
  let timer;
  const result = await Promise.race([item.done, new Promise(r => { timer = setTimeout(() => r(null), 8000); })]);
  clearTimeout(timer);
  if (!result) { process.kill(-item.p.pid, 'SIGKILL'); await item.done; throw new Error(item.name + ' required forced termination'); }
  item.stopped = true;
  assert(result.code === 0 || (item.name === 'chrome' && result.signal === 'SIGTERM'), item.name + ' exited unsuccessfully: ' + JSON.stringify(result));
}
const originSockets = new Set();
const clientSockets = new Set();
let originError;
const trackClient = socket => { clientSockets.add(socket); socket.on('close', () => clientSockets.delete(socket)); };
let origin;
let primaryError;
try {
  run(binaries.OPENSSL, ['req', '-config', '/dev/null', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,DNS:sdk.test,IP:127.0.0.1', '-addext', 'extendedKeyUsage=serverAuth',
    '-keyout', join(temp, 'server.key'), '-out', join(temp, 'server.crt')]);
  const cert = readFileSync(join(temp, 'server.crt')), key = readFileSync(join(temp, 'server.key'));
  const originObservations = [];
  origin = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (req, res) => {
    originObservations.push(req.socket.getProtocol());
    if (req.url === '/disconnect') return; // canceled by the owned test client
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('centillex-origin');
  });
  origin.on('connection', socket => { originSockets.add(socket); socket.on('close', () => originSockets.delete(socket)); socket.on('error', () => {}); });
  origin.on('upgrade', (req, socket, head) => {
    try {
    socket.on('error', () => {});
    assert.equal(req.url, '/ws'); assert.equal(head.length, 0);
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      try {
      buffer = Buffer.concat([buffer, chunk]); assert(buffer.length <= 256);
      if (buffer.length < 6) return;
      const length = buffer[1] & 127; assert(length < 126 && (buffer[1] & 128));
      if (buffer.length < 6 + length) return;
      const opcode = buffer[0] & 15, data = Buffer.from(buffer.subarray(6, 6 + length));
      for (let i = 0; i < length; i++) data[i] ^= buffer[2 + i % 4];
      buffer = buffer.subarray(6 + length); assert.equal(buffer.length, 0);
      if (opcode === 1) { assert.equal(data.toString(), 'sdk-echo'); socket.write(Buffer.concat([Buffer.from([0x81, data.length]), data])); }
      else { assert.equal(opcode, 8); assert.equal(data.readUInt16BE(), 1000); socket.end(Buffer.concat([Buffer.from([0x88, 2]), data])); }
      } catch (e) { originError ??= e; socket.destroy(); }
    });
    } catch (e) { originError ??= e; socket.destroy(); }
  });
  await new Promise(r => origin.listen(0, '127.0.0.1', r));
  const originPort = origin.address().port;
  const reservation = net.createServer();
  await new Promise(r => reservation.listen(0, '127.0.0.1', r));
  const front = reservation.address().port;
  await new Promise(r => reservation.close(r));
  for (const name of ['header', 'lifecycle']) copyFileSync(join(output, name + '.wasm'), join(temp, name + '.wasm'));
  const upstream = `proxy_pass https://127.0.0.1:${originPort}; proxy_http_version 1.1;
    proxy_ssl_verify on; proxy_ssl_trusted_certificate ${temp}/server.crt;
    proxy_ssl_name localhost; proxy_ssl_server_name on; proxy_next_upstream off;
    proxy_connect_timeout 2s; proxy_read_timeout 3s; proxy_send_timeout 3s;`;
  const configuration = `daemon off; master_process off; pid ${temp}/nginx.pid;
    error_log ${temp}/diagnostics.log warn; events { worker_connections 128; }
    wasm { module header ${temp}/header.wasm; module lifecycle ${temp}/lifecycle.wasm; }
    http { access_log off; client_body_temp_path ${temp}/client; proxy_temp_path ${temp}/proxy;
      proxy_wasm_isolation filter;
      server { listen 127.0.0.1:${front} ssl; listen 127.0.0.1:${front} quic;
        http2 on; server_name localhost sdk.test; ssl_certificate ${temp}/server.crt;
        ssl_certificate_key ${temp}/server.key; ssl_protocols TLSv1.3;
        ssl_session_tickets off; ssl_early_data off;
        location = /default { proxy_wasm header; ${upstream} }
        location = /configured { proxy_wasm header 'configured'; ${upstream} }
        location = /chain { proxy_wasm header 'first'; proxy_wasm header 'second'; ${upstream} }
        location = /abort { proxy_wasm lifecycle 'abort'; ${upstream} }
        location = /trap { proxy_wasm lifecycle 'trap'; ${upstream} }
        location = /observe { proxy_wasm lifecycle 'observe'; ${upstream} }
        location = /disconnect { proxy_wasm lifecycle 'observe'; ${upstream} }
        location = /wrong-name { proxy_wasm header; proxy_pass https://127.0.0.1:${originPort};
          proxy_ssl_verify on; proxy_ssl_trusted_certificate ${temp}/server.crt;
          proxy_ssl_server_name on; proxy_ssl_name wrong.invalid; proxy_next_upstream off; }
        location = /ws { proxy_wasm header 'websocket'; ${upstream}
          proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection upgrade; }
      }
    }`;
  const config = write('nginx.conf', configuration);
  run(binaries.NGINX, ['-t', '-p', temp + '/', '-c', config]);
  const worker = start(binaries.NGINX, ['-p', temp + '/', '-c', config], 'nginx', {
    PATH: '/nonexistent', LC_ALL: 'C', OPENSSL_CONF: '/dev/null', OPENSSL_MODULES: '/nonexistent'
  });
  const options = { hostname: '127.0.0.1', port: front, servername: 'localhost', ca: cert, agent: false };
  async function request(path) {
    return new Promise((resolve, reject) => {
      const req = https.get({ ...options, path }, res => {
        let body = ''; res.setEncoding('utf8');
        res.on('data', part => { body += part; if (body.length > 4096) req.destroy(new Error('response budget exceeded')); });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, header: res.headers['x-centillex-wasm'], body }));
      });
      req.on('socket', trackClient);
      req.on('error', reject); req.setTimeout(4000, () => req.destroy(new Error('HTTPS request timeout')));
    });
  }
  for (let attempt = 0; ; attempt++) {
    assert.equal(worker.p.exitCode, null, 'native worker exited before readiness');
    try { await request('/default'); break; }
    catch (e) { if (attempt >= 99) throw e; await sleep(50); }
  }
  for (const [path, header] of [['/default', 'assemblyscript'], ['/configured', 'configured'], ['/chain', 'first, second']]) {
    assert.deepEqual(await request(path), { status: 200, header, body: 'centillex-origin' });
  }
  cases.push('h1-default-configured-and-two-filter-order');
  const callsBefore = originObservations.length;
  for (const path of ['/abort', '/trap', '/wrong-name']) assert.equal((await request(path)).status, 500 + (path === '/wrong-name' ? 2 : 0));
  assert.equal(originObservations.length, callsBefore, 'failed requests reached the origin application');
  cases.push('assemblyscript-abort-and-trap-fail-closed', 'origin-name-verification-fails-closed');
  for (let i = 0; i < 32; i++) assert.equal((await request('/configured')).header, 'configured');
  cases.push('32-healthy-requests-after-guest-failures');
  await request('/observe');
  const countDeletes = () => (readFileSync(join(temp, 'diagnostics.log'), 'utf8').match(/sdk-test-delete/g) || []).length;
  const beforeDelete = countDeletes();
  await new Promise((resolve, reject) => {
    const req = https.get({ ...options, path: '/disconnect' });
    let intentional = false;
    req.on('socket', socket => { trackClient(socket); socket.once('secureConnect', () => setTimeout(() => { intentional = true; req.destroy(); }, 150)); });
    req.on('error', e => intentional ? resolve() : reject(e));
    req.setTimeout(3000, () => req.destroy(new Error('disconnect fixture timeout')));
  });
  for (let i = 0; i < 100 && countDeletes() <= beforeDelete; i++) await sleep(20);
  assert(countDeletes() > beforeDelete, 'disconnect did not destroy the stream context');
  cases.push('native-stream-cleanup-after-client-disconnect');
  const h2 = http2.connect(`https://127.0.0.1:${front}`, { ca: cert, servername: 'localhost' });
  try {
    await new Promise((resolve, reject) => {
      h2.once('error', reject);
      const checked = fn => (...args) => { try { fn(...args); } catch (e) { reject(e); } };
      const stream = h2.request({ ':path': '/configured', ':authority': `localhost:${front}` });
      let body = '';
      stream.setTimeout(4000, () => stream.destroy(new Error('H2 timeout')));
      stream.on('response', checked(headers => { assert.equal(headers[':status'], 200); assert.equal(headers['x-centillex-wasm'], 'configured'); }));
      stream.on('data', checked(chunk => { body += chunk; assert(body.length <= 4096); }));
      stream.on('error', reject);
      stream.on('end', checked(() => { assert.equal(h2.alpnProtocol, 'h2'); assert.equal(body, 'centillex-origin'); resolve(); }));
      stream.end();
    });
  } finally { h2.destroy(); }
  cases.push('verified-h2-application-and-header');

  await new Promise((resolve, reject) => {
    const req = https.get({ ...options, path: '/ws', headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'MDEyMzQ1Njc4OWFiY2RlZg==' } });
    const checked = fn => (...args) => { try { fn(...args); } catch (e) { reject(e); } };
    req.on('socket', trackClient);
    req.on('error', reject); req.on('response', () => { req.destroy(); reject(new Error('WebSocket did not upgrade')); });
    req.on('upgrade', checked((res, socket, head) => {
      assert.equal(res.statusCode, 101); assert.equal(res.headers['x-centillex-wasm'], 'websocket');
      const expected = createHash('sha1').update('MDEyMzQ1Njc4OWFiY2RlZg==258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      assert.equal(res.headers['sec-websocket-accept'], expected);
      assert.equal(head.length, 0);
      function send(opcode, data) {
        const mask = Buffer.from([1, 2, 3, 4]), encoded = Buffer.from(data);
        for (let i = 0; i < encoded.length; i++) encoded[i] ^= mask[i % 4];
        socket.write(Buffer.concat([Buffer.from([128 | opcode, 128 | data.length]), mask, encoded]));
      }
      let buffer = Buffer.alloc(0), echoed = false;
      socket.on('error', reject); socket.setTimeout(4000, () => socket.destroy(new Error('WebSocket timeout')));
      socket.on('data', checked(chunk => {
        buffer = Buffer.concat([buffer, chunk]); assert(buffer.length <= 256);
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        const opcode = buffer[0] & 15, data = buffer.subarray(2); buffer = Buffer.alloc(0);
        if (opcode === 1) { assert.equal(data.toString(), 'sdk-echo'); echoed = true; send(8, Buffer.from([3, 232])); }
        else { assert.equal(opcode, 8); assert.equal(data.readUInt16BE(), 1000); assert(echoed); socket.end(); resolve(); }
      }));
      send(1, Buffer.from('sdk-echo'));
    }));
    req.setTimeout(4000, () => req.destroy(new Error('WebSocket upgrade timeout')));
  });
  cases.push('verified-websocket-upgrade-header-echo-and-close');

  const spki = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  const pin = createHash('sha256').update(spki).digest('base64');
  const profile = join(temp, 'chrome-profile');
  const chrome = start(binaries.CHROME, ['--headless=new', '--user-data-dir=' + profile, '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
    '--disable-background-networking', '--disable-sync', '--disable-component-update', '--enable-quic',
    '--host-resolver-rules=MAP sdk.test 127.0.0.1', '--origin-to-force-quic-on=sdk.test:' + front,
    '--ignore-certificate-errors-spki-list=' + pin, 'about:blank'], 'chrome');
  let devPort;
  for (let i = 0; i < 100; i++) {
    assert.equal(chrome.p.exitCode, null, 'Chrome exited');
    try { devPort = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; }
    catch { await sleep(100); }
  }
  assert(Number.isInteger(devPort) && devPort > 0 && devPort < 65536);
  const pages = await (await fetch(`http://127.0.0.1:${devPort}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
  const page = pages.find(p => p.type === 'page' && p.url === 'about:blank');
  assert(page.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${devPort}/devtools/page/`));
  const cdp = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(); let sequence = 0, observed;
  let complete, fail;
  const finished = new Promise((resolve, reject) => { complete = resolve; fail = reject; }); finished.catch(() => {});
  let requestID;
  const url = `https://sdk.test:${front}/configured`;
  cdp.addEventListener('message', event => {
    try {
      const m = JSON.parse(event.data);
      if (m.id) { const p = pending.get(m.id); assert(p); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      if (m.method === 'Network.responseReceived' && m.params.response.url === url) { observed = m.params.response; requestID = m.params.requestId; }
      if (requestID && m.method === 'Network.loadingFinished' && m.params.requestId === requestID) complete();
      if (m.method === 'Network.loadingFailed') fail(new Error('Chrome request failed'));
    } catch (e) { fail(e); }
  });
  function call(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('DevTools timeout: ' + method)); }, 10000);
      pending.set(id, { resolve, reject, timer }); cdp.send(JSON.stringify({ id, method, params }));
    });
  }
  let deadline;
  try {
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('DevTools open timeout')), 10000); cdp.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true }); cdp.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('DevTools open failed')); }, { once: true }); });
    await call('Network.enable', { maxTotalBufferSize: 65536, maxResourceBufferSize: 8192 });
    await call('Network.setCacheDisabled', { cacheDisabled: true });
    const navigation = await call('Page.navigate', { url }); assert(!navigation.errorText, navigation.errorText);
    await Promise.race([finished, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('H3 response timeout')), 15000); })]);
    assert.equal(observed.protocol, 'h3', 'TCP fallback is not H3 success'); assert.equal(observed.status, 200);
    const header = Object.entries(observed.headers).find(([key]) => key.toLowerCase() === 'x-centillex-wasm');
    assert.equal(header?.[1], 'configured');
    const body = await call('Network.getResponseBody', { requestId: requestID });
    assert(!body.base64Encoded); assert.equal(body.body, 'centillex-origin');
  } finally { clearTimeout(deadline); for (const p of pending.values()) clearTimeout(p.timer); cdp.close(); await stop(chrome); }
  cases.push('real-chrome-h3-application-and-header-ephemeral-spki-pin');
  if (originError) throw originError;
  assert(originObservations.length > 32 && originObservations.every(p => ['TLSv1.2', 'TLSv1.3'].includes(p)));
  const log = readFileSync(join(temp, 'diagnostics.log'), 'utf8');
  assert(log.length < 1 << 20 && log.includes('intentional SDK assertion fixture'));
  await stop(worker);
  cases.push('joined-clean-native-shutdown');
  const report = { passed: true, sourceSHA256: fingerprint(), packageSHA256: pkg.packageSHA256, modules: pkg.modules,
    binaries: Object.fromEntries(Object.entries(binaries).map(([k, p]) => [k, hashFile(p)])),
    chromeVersion: run(binaries.CHROME, ['--version']).trim(), staticELF: true, cases,
    scope: 'Owned loopback NGINX/Wasmtime fixture with verified HTTPS origin. Ephemeral Chrome SPKI pin only; no public trust claim, live deployment, load test or arbitrary-plugin qualification.' };
  writeFileSync(join(output, 'native-tests.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) { primaryError = error; throw error; }
finally {
  let cleanupError;
  for (const child of owned.reverse()) { try { await stop(child); } catch (e) { cleanupError ??= e; } }
  for (const socket of clientSockets) socket.destroy();
  for (const socket of originSockets) socket.destroy();
  if (origin) await new Promise(r => origin.close(r));
  if (primaryError || cleanupError) {
    rmSync(join(output, 'native-tests.json'), { force: true });
    console.error('Private fixture diagnostics retained at ' + temp);
    if (cleanupError && !primaryError) throw cleanupError;
  } else rmSync(temp, { recursive: true, force: true });
}
