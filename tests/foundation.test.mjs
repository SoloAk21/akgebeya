import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const compiler = fileURLToPath(new URL('node_modules/typescript/bin/tsc', root));

test('all workspaces compile into isolated, importable ES modules', async () => {
  const output = mkdtempSync(join(tmpdir(), 'akgebeya-foundation-'));
  assert.equal(dirname(resolve(output)), resolve(tmpdir()));
  try {
    writeFileSync(join(output, 'package.json'), '{"type":"module"}');
    for (const workspace of ['apps/api', 'apps/web', 'packages/shared']) {
      const destination = join(output, workspace);
      const result = spawnSync('node', [
        compiler, '--project', fileURLToPath(new URL(`${workspace}/tsconfig.json`, root)),
        '--outDir', destination,
      ], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
      const entry = workspace === 'apps/api' ? 'server' : workspace === 'apps/web' ? 'health' : 'index';
      const emitted = readFileSync(join(destination, `${entry}.js`), 'utf8');
      assert.match(emitted, /export/);
      assert.ok(readFileSync(join(destination, 'index.d.ts'), 'utf8').length > 0);
      await import(pathToFileURL(join(destination, `${entry}.js`)).href);
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
