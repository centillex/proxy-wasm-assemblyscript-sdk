import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sha = data => createHash('sha256').update(data).digest('hex');
export const hashFile = path => sha(readFileSync(path));
export function run(command, args, cwd = root) {
  const p = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 2 << 20 });
  if (p.error || p.status !== 0) throw new Error(`${command} failed (${p.status}): ${p.error?.message ?? p.stderr.slice(-4096)}`);
  return p.stdout;
}
export function fingerprint() {
  const paths = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean).sort();
  const h = createHash('sha256');
  for (const path of [...new Set(paths)]) {
    if (!existsSync(resolve(root, path))) continue; // staged/worktree deletions
    const stat = lstatSync(resolve(root, path));
    if (!stat.isFile() || stat.size > 5 << 20) throw new Error('Unexpected source input: ' + path);
    h.update(path + '\0').update(readFileSync(resolve(root, path))).update('\0');
  }
  return h.digest('hex');
}
export function pack(destination) {
  const [metadata] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination]));
  return { metadata, path: resolve(destination, metadata.filename) };
}
