/**
 * Bazel remote cache tests.
 *
 * Static suite: verifies the service definition in src/services.ts has the
 * correct id, daggerFn, and port — no Docker required.
 *
 * Live suite: starts the cache stub container and verifies the /status and
 * CAS/AC endpoints respond as expected. These will be updated when the stub
 * is replaced with a real buchgr/bazel-remote instance.
 */

import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SERVICES } from '../../services';

const CONTAINER = 'scorenado-bazel-cache-test';
const IMAGE = 'python:3.12-alpine';
const TEST_PORT = 19090; // offset from default 9090 to avoid collisions
const BASE = `http://localhost:${TEST_PORT}`;

// Inline the same server script used in bazel.ts so the test is self-contained
const SERVER_SCRIPT = `
import http.server

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/status":
            body = b'{"state":"ok"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/cas/") or self.path.startswith("/ac/"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
    def log_message(self, *a):
        pass

http.server.HTTPServer(("", 9090), H).serve_forever()
`.trim();

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
  throw new Error(`bazel-cache did not become ready at ${url} within ${timeoutMs}ms`);
}

// ── Static checks ─────────────────────────────────────────────────────────────

suite('Bazel remote cache — service definition', () => {
  const def = SERVICES.find(s => s.id === 'bazel-remote-cache');

  test('bazel-remote-cache entry exists in SERVICES', () => {
    assert.ok(def, 'SERVICES should contain an entry with id "bazel-remote-cache"');
  });

  test('daggerFn is "bazel-remote-cache"', () => {
    assert.strictEqual(def?.daggerFn, 'bazel-remote-cache');
  });

  test('port is 9090', () => {
    assert.ok(def?.ports.includes(9090), 'ports should include 9090');
  });

  test('daggerArg is "bazel-remote-cache"', () => {
    assert.strictEqual(def?.daggerArg, 'bazel-remote-cache');
  });
});

// ── Live container checks ─────────────────────────────────────────────────────

suite('Bazel remote cache — live container', function () {
  this.timeout(60_000);

  let tmpScript: string;

  suiteSetup(async function () {
    if (!dockerAvailable()) { this.skip(); }
    // Write the server script to a temp file and volume-mount it into the container.
    tmpScript = path.join(os.tmpdir(), 'scorenado-bazel-cache-test.py');
    fs.writeFileSync(tmpScript, SERVER_SCRIPT, 'utf8');
    cp.spawnSync('docker', [
      'run', '-d', '--rm', '--name', CONTAINER,
      '-p', `${TEST_PORT}:9090`,
      '-v', `${tmpScript}:/srv.py`,
      IMAGE,
      'python3', '/srv.py',
    ], { stdio: 'pipe' });
    await waitReady(`${BASE}/status`);
  });

  suiteTeardown(() => {
    cp.spawnSync('docker', ['stop', CONTAINER], { stdio: 'ignore' });
    if (tmpScript) { fs.unlinkSync(tmpScript); }
  });

  test('/status responds 200 with state:ok', async () => {
    const resp = await fetch(`${BASE}/status`);
    assert.strictEqual(resp.status, 200);
    const body = await resp.json() as { state: string };
    assert.strictEqual(body.state, 'ok');
  });

  test('/cas/<key> responds 404 (cache miss)', async () => {
    const resp = await fetch(`${BASE}/cas/abc123`);
    assert.strictEqual(resp.status, 404);
  });

  test('/ac/<key> responds 404 (cache miss)', async () => {
    const resp = await fetch(`${BASE}/ac/abc123`);
    assert.strictEqual(resp.status, 404);
  });
});
