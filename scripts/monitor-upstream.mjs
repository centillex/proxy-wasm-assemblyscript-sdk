// Read metadata only. Never download/execute upstream code or merge updates.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './common.mjs';
const config = JSON.parse(readFileSync(join(root, '.github/upstreams.json')));
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
async function json(url, options = {}, allow404 = false) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (allow404 && response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw new Error('Metadata request failed: ' + response.status + ' ' + url); }
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > 2 << 20) throw new Error('Metadata response exceeded budget'); chunks.push(value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const observations = { repositories: [], npm: {}, review: [] };
for (const pin of config.repositories) {
  const base = 'https://api.github.com/repos/' + pin.repo;
  const head = await json(base + '/commits?per_page=1', { headers });
  const release = await json(base + '/releases/latest', { headers }, true);
  const advisories = [];
  // Recent public repository advisories, paginated with a finite budget.
  let available = true;
  for (let page = 1; ; page++) {
    if (page > 10) throw new Error('Advisory pagination budget exceeded');
    const entries = await json(base + '/security-advisories?per_page=100&page=' + page, { headers }, true);
    if (entries === null) { available = false; break; }
    advisories.push(...entries.map(x => ({ id: x.ghsa_id, severity: x.severity, url: x.html_url, updated: x.updated_at })));
    if (entries.length < 100) break;
  }
  const row = { repo: pin.repo, head: head[0].sha, release: release?.tag_name ?? null, advisoriesAvailable: available, advisories };
  observations.repositories.push(row);
  if (pin.commit && pin.commit !== row.head) observations.review.push(pin.repo + ': upstream HEAD differs from recorded baseline');
  if (pin.release && pin.release !== row.release) observations.review.push(pin.repo + ': release differs from recorded baseline');
  if (!available) observations.review.push(pin.repo + ': public advisory endpoint unavailable; manual security review required');
  if (advisories.length) observations.review.push(pin.repo + ': review public advisories for applicability (not an automatic vulnerability determination)');
}
for (const [name, pin] of Object.entries(config.npm)) {
  const data = await json('https://registry.npmjs.org/' + encodeURIComponent(name) + '/latest');
  observations.npm[name] = data.version;
  if (data.version !== pin) observations.review.push(name + ': npm latest differs from pinned compiler/SDK baseline');
}
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build/upstream-observations.json'), JSON.stringify(observations, null, 2) + '\n');
console.log(JSON.stringify(observations, null, 2));
if (process.argv.includes('--issue') && observations.review.length) {
  if (process.env.GITHUB_REPOSITORY !== 'centillex/proxy-wasm-assemblyscript-sdk') throw new Error('Issue updates are restricted to the Centillex repository');
  const title = '[maintenance] Upstream review queue';
  const base = 'https://api.github.com/repos/centillex/proxy-wasm-assemblyscript-sdk/issues';
  const issues = [];
  for (let page = 1; ; page++) {
    if (page > 10) throw new Error('Issue pagination budget exceeded');
    const rows = await json(base + '?state=open&per_page=100&page=' + page, { headers }); issues.push(...rows);
    if (rows.length < 100) break;
  }
  const existing = issues.find(x => x.title === title && !x.pull_request && x.user?.login === 'github-actions[bot]');
  const body = 'Automated metadata observations only. Review changes and advisory applicability; do not auto-merge or infer that the pinned build is vulnerable.\n\n' +
    observations.review.map(x => '- ' + x).join('\n') + '\n\n```json\n' + JSON.stringify(observations, null, 2) + '\n```\n';
  if (body.length > 60000) throw new Error('Issue evidence budget exceeded');
  if (!existing || existing.body !== body) await json(existing ? base + '/' + existing.number : base, {
    method: existing ? 'PATCH' : 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body })
  });
}
