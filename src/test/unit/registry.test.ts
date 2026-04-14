/**
 * Container registry tests.
 *
 * Static suite: verifies the service definition in src/services.ts has the
 * correct id, daggerFn, and port — no Docker required.
 *
 * Live suite: starts a throw-away registry:2 container and verifies the
 * /v2/ API responds correctly.
 */

import * as assert from 'assert';
import * as cp from 'child_process';
import { SERVICES } from '../../services';

const CONTAINER = 'scorenado-registry-test';
const IMAGE = 'registry:2';
const TEST_PORT = 15000;
const BASE = `http://localhost:${TEST_PORT}`;

function dockerAvailable(): boolean {
  const r = cp.spawnSync('docker', ['info'], { stdio: 'ignore' });
  return r.status === 0;
}

async function waitReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) { return; }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`registry did not become ready at ${url} within ${timeoutMs}ms`);
}

// ── Static checks ─────────────────────────────────────────────────────────────

suite('Container registry — service definition', () => {
  const def = SERVICES.find(s => s.id === 'ocr');

  test('ocr entry exists in SERVICES', () => {
    assert.ok(def, 'SERVICES should contain an entry with id "ocr"');
  });

  test('daggerFn is "ocr"', () => {
    assert.strictEqual(def?.daggerFn, 'ocr');
  });

  test('port is 5000', () => {
    assert.ok(def?.ports.includes(5000), 'ports should include 5000');
  });

  test('daggerArg is "ocr"', () => {
    assert.strictEqual(def?.daggerArg, 'ocr');
  });
});

// ── Live container checks ─────────────────────────────────────────────────────

suite('Container registry — live container', function () {
  this.timeout(60_000);

  suiteSetup(async function () {
    if (!dockerAvailable()) { this.skip(); }
    cp.execSync(
      `docker run -d --rm --name ${CONTAINER} -p ${TEST_PORT}:5000 ${IMAGE}`,
      { stdio: 'pipe' },
    );
    await waitReady(`${BASE}/v2/`);
  });

  suiteTeardown(() => {
    cp.spawnSync('docker', ['stop', CONTAINER], { stdio: 'ignore' });
  });

  test('/v2/ responds 200', async () => {
    const resp = await fetch(`${BASE}/v2/`);
    assert.strictEqual(resp.status, 200);
  });

  test('/v2/_catalog returns empty repositories list', async () => {
    const resp = await fetch(`${BASE}/v2/_catalog`);
    assert.strictEqual(resp.status, 200);
    const body = await resp.json() as { repositories: string[] };
    assert.deepStrictEqual(body.repositories, []);
  });
});
