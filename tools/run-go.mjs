import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, 'artifacts', 'go');
const tmp = join(root, 'artifacts', 'tmp');
mkdirSync(tmp, { recursive: true });
mkdirSync(cache, { recursive: true });
const child = spawn('go', process.argv.slice(2), {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CGO_ENABLED: process.env.CGO_ENABLED ?? '0', GOPATH: cache, GOMODCACHE: join(cache, 'pkg', 'mod'), GOCACHE: join(cache, 'build'), TMPDIR: tmp },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
