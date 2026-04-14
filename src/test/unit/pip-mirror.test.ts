/**
 * PyPI mirror tests.
 *
 * Static suite: verifies the service definition in src/services.ts has the
 * correct id, daggerFn, and port — no Docker required.
 *
 * Live suite: starts the uv/pypiserver container and verifies the /simple/
 * index endpoint is reachable. Full round-trip (download + upload + verify)
 * is covered by the Dagger smoke test (test-pypi) in pipelineBindings.test.ts.
 */

import * as assert from 'assert';
import * as cp from 'child_process';
import { SERVICES } from '../../services';

const CONTAINER = 'scorenado-pip-mirror-test';
const IMAGE = 'ghcr.io/astral-sh/uv:alpine';
const TEST_PORT = 13142; // offset from the default 3141 to avoid collisions
const BASE = `http://localhost:${TEST_PORT}`;

function dockerAvailable(): boolean {
  const r = cp.spawnSync('docker', ['info'], { stdio: 'ignore' });
  return r.status === 0;
}

async function waitReady(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) { return; }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`pip-mirror did not become ready at ${url} within ${timeoutMs}ms`);
}

// ── Static checks ─────────────────────────────────────────────────────────────

suite('PyPI mirror — service definition', () => {
  const def = SERVICES.find(s => s.id === 'pip-mirror');

  test('pip-mirror entry exists in SERVICES', () => {
    assert.ok(def, 'SERVICES should contain an entry with id "pip-mirror"');
  });

  test('daggerFn is "pip-mirror"', () => {
    assert.strictEqual(def?.daggerFn, 'pip-mirror');
  });

  test('port is 3141', () => {
    assert.ok(def?.ports.includes(3141), 'ports should include 3141');
  });

  test('daggerArg is "pip-mirror"', () => {
    assert.strictEqual(def?.daggerArg, 'pip-mirror');
  });
});

// ── Live container checks ─────────────────────────────────────────────────────

suite('PyPI mirror — live container', function () {
  // uv needs to download pypiserver + gunicorn on first run; allow extra time.
  this.timeout(120_000);

  suiteSetup(async function () {
    if (!dockerAvailable()) { this.skip(); }
    cp.spawnSync('docker', [
      'run', '-d', '--rm', '--name', CONTAINER,
      '-p', `${TEST_PORT}:3141`,
      '--entrypoint', 'sh',
      IMAGE,
      '-c',
      'mkdir -p /data/packages && uv run --with pypiserver --with gunicorn ' +
      'pypi-server run --server gunicorn -p 3141 -a . -P . /data/packages',
    ], { stdio: 'pipe' });
    await waitReady(`${BASE}/simple/`);
  });

  suiteTeardown(() => {
    cp.spawnSync('docker', ['stop', CONTAINER], { stdio: 'ignore' });
  });

  test('/simple/ index responds 200', async () => {
    const resp = await fetch(`${BASE}/simple/`);
    assert.strictEqual(resp.status, 200);
  });

  test('/simple/ index contains "Simple index" header', async () => {
    const resp = await fetch(`${BASE}/simple/`);
    const text = await resp.text();
    assert.ok(
      text.toLowerCase().includes('simple index'),
      `expected "Simple index" in response, got: ${text.slice(0, 200)}`,
    );
  });
});
