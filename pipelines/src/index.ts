/**
 * Scorenado pipeline functions
 *
 * Mirrors the three core Scorenado Makefile targets so they can be
 * driven from the score-ide VS Code extension via `dagger call`.
 *
 * Usage (CLI):
 *   dagger call build --source .
 *   dagger call test  --source .
 *   dagger call shell --source .
 *   dagger call test-otel --otel tcp://localhost:4318
 *   dagger call test-ocr --ocr tcp://localhost:8080
 *
 * OTel tracing:
 *   Dagger's engine-level traces are exported automatically when
 *   OTEL_EXPORTER_OTLP_ENDPOINT is set in the calling environment.
 *   The score-ide extension injects this env var when the otel-webui
 *   service is running, so no pipeline-function arguments are needed.
 *
 *   TODO: In-container OTel forwarding (so build/test scripts running
 *   inside the container can also export traces) requires
 *   dag.host().service([PortForward(...)]) to tunnel the host collector
 *   port into the container. That API is available in the Python dagger-io
 *   SDK (see scorenado/scripts/_core/dagger_runtime.py :: bind_otel) but
 *   is not exposed in TypeScript module functions in Dagger v0.20.x.
 *   Until it becomes available, in-container tracing must go via the
 *   Python-script path (dagger run uv run --script scripts/build.py ...).
 *
 * Services (run with `dagger call <fn> up`):
 *   dagger call otel-webui up
 *   dagger call ocr up
 *   dagger call pip-mirror up
 *   dagger call bazel-remote-cache up
 */
import {
  dag,
  Container,
  Directory,
  Service,
  object,
  func,
} from "@dagger.io/dagger";

@object()
export class ScorenadoPipelines {
  // ── Pipeline functions ─────────────────────────────────────────────────────

  // TODO: Implement real build logic.
  // This should mirror `make build/<repo>` / `dagger run uv run --script scripts/build.py --repo <repo>`
  // from the Scorenado Makefile. The container needs the repo's toolchain, the
  // source tree mounted, and the Scorenado catalog/secrets available so the
  // generated targets.mk build steps can run.
  @func()
  async build(source: Directory): Promise<string> {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec(["bash", "-c", "echo '>>> build placeholder' && echo 'Done.'"])
      .stdout();
  }

  // TODO: Replace with real per-repo test functions.
  @func()
  async test(source: Directory): Promise<string> {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec([
        "bash",
        "-c",
        "echo '>>> test placeholder' && echo 'All tests passed.'",
      ])
      .stdout();
  }

  // TODO: Replace with real per-repo shell functions.
  @func()
  shell(source: Directory): Container {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .terminal();
  }

  /**
   * End-to-end smoke test for the OTel service binding path.
   *
   * Expected usage:
   *   dagger call test-otel --otel tcp://localhost:4318
   */
  @func()
  async testOtel(otel: Service): Promise<string> {
    const endpoint = await otel.endpoint({ scheme: "http" });
    await dag.http(endpoint).contents();
    return "otel service reachable";
  }

  /**
   * End-to-end smoke test for the OCR service binding path.
   *
   * Expected usage:
   *   dagger call test-ocr --ocr tcp://localhost:8080
   */
  @func()
  async testOcr(ocr: Service): Promise<string> {
    const endpoint = await ocr.endpoint({ scheme: "http" });
    const body = await dag.http(endpoint).contents();
    if (!body.includes('"status":"ok"')) {
      throw new Error(`unexpected OCR response body: ${body}`);
    }
    return "ocr service reachable";
  }

  // ── Service functions ──────────────────────────────────────────────────────

  /**
   * OCI registry (registry:2).
   * Binds to host port 5000; use `dagger call oci-registry up` to expose it.
   * testRegistry uses withServiceBinding to hit /v2/ inside the Dagger DAG.
   */
  @func()
  ociRegistry(): Service {
    return dag.container().from("registry:2").withExposedPort(5000).asService();
  }

  /**
   * OpenTelemetry collector + web UI (ghcr.io/metafab/otel-gui).
   * Binds to host port 4318; Dagger engine traces flow to it automatically
   * when OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 is in the environment.
   * Equivalent to: make otel-webui
   */
  @func()
  otelWebui(): Service {
    return dag
      .container()
      .from("ghcr.io/metafab/otel-gui:latest")
      .withExposedPort(4318)
      .asService();
  }

  /**
   * OCR sidecar service.
   * TODO: Replace with real OCR image once available.
   */
  @func()
  ocr(): Service {
    return dag
      .container()
      .from("hashicorp/http-echo:1.0.0")
      .withExposedPort(8080)
      .asService({
        args: ["-listen=:8080", '-text={"status":"ok"}'],
        useEntrypoint: true,
      });
  }

  /**
   * Local PyPI mirror for air-gapped builds.
   * TODO: Replace with real devpi / pypiserver instance.
   */
  @func()
  pipMirror(): Service {
    const server = `\
import http.server

SIMPLE_HTML = b"""<!DOCTYPE html>
<html><head><title>Simple index</title></head>
<body><h1>Simple index</h1></body></html>
"""

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(SIMPLE_HTML)))
        self.end_headers()
        self.wfile.write(SIMPLE_HTML)
    def log_message(self, *a):
        pass

http.server.HTTPServer(("", 3141), H).serve_forever()
`;
    return dag
      .container()
      .from("python:3.12-alpine")
      .withNewFile("/server.py", server)
      .withExposedPort(3141)
      .asService({ args: ["python3", "/server.py"] });
  }

  /**
   * Bazel remote cache over HTTP.
   * TODO: Replace with real buchgr/bazel-remote instance.
   */
  @func()
  bazelRemoteCache(): Service {
    const server = `\
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
`;
    return dag
      .container()
      .from("python:3.12-alpine")
      .withNewFile("/server.py", server)
      .withExposedPort(9090)
      .asService({ args: ["python3", "/server.py"] });
  }
}
