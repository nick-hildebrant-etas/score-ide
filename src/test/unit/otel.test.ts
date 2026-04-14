/**
 * OTel Web UI tests — mirrors test_story_22_otel_webui.py from Scorenado.
 *
 * Static suite: verifies the service definition in src/services.ts has the
 * correct port, env vars, and image — no Docker required.
 *
 * Live suite: starts a throw-away container on port 14318 (avoiding collision
 * with a running otel-webui instance on 4318), verifies the HTTP endpoints
 * respond correctly, and tears down afterwards.
 */

import * as assert from 'assert';
import * as cp from 'child_process';
import { SERVICES } from '../../services';

const CONTAINER = 'scorenado-otel-test';
const IMAGE = 'ghcr.io/metafab/otel-gui:latest';
const TEST_PORT = 14318;
const BASE = `http://localhost:${TEST_PORT}`;

const MINIMAL_TRACE = JSON.stringify({
  resourceSpans: [{
    resource: {
      attributes: [{ key: 'service.name', value: { stringValue: 'score-ide-test' } }],
    },
    scopeSpans: [{
      scope: { name: 'test' },
      spans: [{
        traceId: '5b8efff798038103d269b633813fc60c',
        spanId: 'eee19b7ec3c1b174',
        name: 'otel-webui-test',
        kind: 1,
        startTimeUnixNano: '1700000000000000000',
        endTimeUnixNano: '1700000001000000000',
        status: {},
      }],
    }],
  }],
});

function dockerAvailable(): boolean {
  const r = cp.spawnSync('docker', ['info'], { stdio: 'ignore' });
  return r.status === 0;
}

async function waitReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`otel-gui did not become ready at ${url} within ${timeoutMs}ms`);
}

// ── Static checks ─────────────────────────────────────────────────────────────

suite('OTel Web UI — service definition', () => {
  const def = SERVICES.find(s => s.id === 'otel-webui');

  test('otel-webui entry exists in SERVICES', () => {
    assert.ok(def, 'SERVICES should contain an entry with id "otel-webui"');
  });

  test('daggerFn matches image/function name', () => {
    assert.strictEqual(def?.daggerFn, 'otel-webui');
  });

  test('port is 4318', () => {
    assert.ok(def?.ports.includes(4318), 'ports should include 4318');
  });

  test('OTEL_EXPORTER_OTLP_ENDPOINT env var points to port 4318', () => {
    const endpoint = def?.envVars?.['OTEL_EXPORTER_OTLP_ENDPOINT'];
    assert.ok(endpoint, 'envVars should include OTEL_EXPORTER_OTLP_ENDPOINT');
    assert.ok(endpoint.includes('4318'), `endpoint should reference port 4318, got: ${endpoint}`);
  });

  test('OTEL_EXPORTER_OTLP_PROTOCOL is http/protobuf', () => {
    assert.strictEqual(
      def?.envVars?.['OTEL_EXPORTER_OTLP_PROTOCOL'],
      'http/protobuf',
    );
  });

  test('OTEL_METRICS_EXPORTER is none', () => {
    assert.strictEqual(
      def?.envVars?.['OTEL_METRICS_EXPORTER'],
      'none',
    );
  });
});

// ── Live container checks ─────────────────────────────────────────────────────

suite('OTel Web UI — live container', function () {
  // Docker pull + start can be slow on a cold image cache.
  this.timeout(60_000);

  suiteSetup(async function () {
    if (!dockerAvailable()) {
      this.skip();
    }
    cp.execSync(
      `docker run -d --rm --name ${CONTAINER} -p ${TEST_PORT}:4318 ${IMAGE}`,
      { stdio: 'pipe' },
    );
    await waitReady(BASE);
  });

  suiteTeardown(() => {
    cp.spawnSync('docker', ['stop', CONTAINER], { stdio: 'ignore' });
  });

  test('root URL responds 200', async () => {
    const resp = await fetch(BASE);
    assert.strictEqual(resp.status, 200);
  });

  test('OTLP /v1/traces endpoint accepts JSON and responds 200', async () => {
    const resp = await fetch(`${BASE}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: MINIMAL_TRACE,
    });
    assert.strictEqual(resp.status, 200);
  });
});
