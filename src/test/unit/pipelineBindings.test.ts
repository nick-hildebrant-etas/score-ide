import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const PIPELINES_DIR = path.join(ROOT, "pipelines");
const TEST_OTEL_PORT = 14318;
const TEST_OCR_PORT = 18080;
const TEST_PIP_PORT = 13141;

function resolveServiceHost(): string {
  const override = process.env.SCORE_IDE_SERVICE_HOST?.trim();
  if (override) {
    return override;
  }

  if (!fs.existsSync("/.dockerenv")) {
    return "localhost";
  }

  const net = os.networkInterfaces();
  const isIPv4 = (family: string | number): boolean =>
    family === "IPv4" || family === 4;

  for (const iface of ["eth0", "en0"]) {
    const entries = net[iface] ?? [];
    for (const e of entries) {
      if (isIPv4(e.family) && !e.internal) {
        return e.address;
      }
    }
  }

  for (const entries of Object.values(net)) {
    for (const e of entries ?? []) {
      if (isIPv4(e.family) && !e.internal) {
        return e.address;
      }
    }
  }

  return "localhost";
}

function daggerAvailable(): boolean {
  const r = cp.spawnSync("dagger", ["version"], { stdio: "ignore" });
  return r.status === 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitReady(
  url: string,
  proc: cp.ChildProcess,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `service process exited with code ${proc.exitCode} while waiting for ${url}`,
      );
    }
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        return;
      }
    } catch {
      // service not ready yet
    }
    await delay(500);
  }
  throw new Error(`service did not become ready at ${url}`);
}

async function ensureService(
  fn: string,
  backendPort: number,
  frontendPort: number,
  healthUrl: string,
): Promise<cp.ChildProcess | undefined> {
  try {
    const ready = await fetch(healthUrl);
    if (ready.ok) {
      return undefined;
    }
  } catch {
    // no running tunnel on this port
  }

  const proc = cp.spawn(
    "dagger",
    [
      "call",
      fn,
      "up",
      "--ports",
      `${frontendPort}:${backendPort}`,
      "--progress",
      "plain",
    ],
    {
      cwd: PIPELINES_DIR,
      env: { ...process.env, DAGGER_NO_NAG: "1" },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );

  await waitReady(healthUrl, proc);
  return proc;
}

function runPipeline(fn: string, argName: string, argValue: string): string {
  const r = cp.spawnSync(
    "dagger",
    ["call", "--progress", "plain", fn, `--${argName}`, argValue],
    {
      cwd: PIPELINES_DIR,
      env: { ...process.env, DAGGER_NO_NAG: "1" },
      encoding: "utf8",
      timeout: 120_000,
    },
  );

  if (r.error) {
    throw r.error;
  }

  if (r.signal) {
    assert.fail(
      `dagger call ${fn} was terminated by signal ${r.signal}. stdout:\n${r.stdout ?? ""}\nstderr:\n${r.stderr ?? ""}`,
    );
  }

  const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  assert.strictEqual(r.status, 0, `dagger call ${fn} failed:\n${output}`);
  return output;
}

function stopService(proc: cp.ChildProcess | undefined): void {
  if (!proc || proc.exitCode !== null) {
    return;
  }
  proc.kill("SIGTERM");
}

suite("Pipeline service binding smoke tests (no browser)", function () {
  this.timeout(180_000);

  let ocrProc: cp.ChildProcess | undefined;
  let otelProc: cp.ChildProcess | undefined;
  let pipProc: cp.ChildProcess | undefined;
  let serviceHost = "localhost";

  suiteSetup(async function () {
    if (!daggerAvailable()) {
      this.skip();
    }
    serviceHost = resolveServiceHost();

    otelProc = await ensureService(
      "otel-webui",
      4318,
      TEST_OTEL_PORT,
      `http://localhost:${TEST_OTEL_PORT}/`,
    );
    ocrProc = await ensureService(
      "ocr",
      5000,
      TEST_OCR_PORT,
      `http://localhost:${TEST_OCR_PORT}/v2/`,
    );
    pipProc = await ensureService(
      "pip-mirror",
      3141,
      TEST_PIP_PORT,
      `http://localhost:${TEST_PIP_PORT}/simple/`,
    );
  });

  suiteTeardown(() => {
    stopService(ocrProc);
    stopService(otelProc);
    stopService(pipProc);
  });

  test("test-otel passes when otel service is running", () => {
    const output = runPipeline(
      "test-otel",
      "otel",
      `tcp://${serviceHost}:${TEST_OTEL_PORT}`,
    );
    assert.match(output, /otel service reachable/);
  });

  test("test-ocr passes when ocr service is running", () => {
    const output = runPipeline(
      "test-ocr",
      "ocr",
      `tcp://${serviceHost}:${TEST_OCR_PORT}`,
    );
    assert.match(output, /ocr service reachable/);
  });

  test("test-pypi passes when pip-mirror service is running", () => {
    const output = runPipeline(
      "test-pypi",
      "pip-mirror",
      `tcp://${serviceHost}:${TEST_PIP_PORT}`,
    );
    assert.match(output, /pip-mirror service reachable/);
  });
});
