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
   * Smoke test for the OCI registry service binding path.
   * Verifies the registry v2 API is reachable via its Dagger service endpoint.
   *
   * Expected usage:
   *   dagger call test-ocr --ocr tcp://localhost:5000
   */
  @func()
  async testOcr(ocr: Service): Promise<string> {
    const endpoint = await ocr.endpoint({ scheme: "http" });
    const body = await dag.http(`${endpoint}/v2/`).contents();
    return `ocr registry reachable: ${body}`;
  }

  /**
   * End-to-end smoke test for the PyPI mirror service binding path.
   * Downloads numpy from PyPI, uploads it to the mirror via twine, then
   * verifies numpy appears in the mirror's /simple/ index.
   *
   * Expected usage:
   *   dagger call test-pypi --pip-mirror tcp://localhost:3141
   */
  @func()
  async testPypi(pipMirror: Service): Promise<string> {
    const endpoint = await pipMirror.endpoint({ scheme: "http" });
    const port = endpoint.split(":").pop()!;
    const mirrorUrl = `http://pip-mirror:${port}`;

    const index = await dag
      .container()
      .from("ghcr.io/astral-sh/uv:alpine")
      .withServiceBinding("pip-mirror", pipMirror)
      .withEnvVariable("TWINE_USERNAME", "dummy")
      .withEnvVariable("TWINE_PASSWORD", "dummy")
      .withExec(["uv", "tool", "install", "twine"])
      .withExec(["uv", "run", "python", "-m", "pip", "download", "numpy", "--dest", "/packages"])
      .withExec([
        "sh", "-c",
        `uv tool run twine upload --repository-url ${mirrorUrl} /packages/*`,
      ])
      .withExec(["wget", "-qO-", `${mirrorUrl}/simple/`])
      .stdout();

    if (!index.includes("numpy")) {
      throw new Error(`numpy not found in mirror index after upload: ${index}`);
    }
    return "pip-mirror: numpy mirrored and verified";
  }

  // ── Service functions ──────────────────────────────────────────────────────

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
   * Local OCI container registry (Docker registry v2).
   * Consumers push/pull images via tcp://<host>:5000.
   */
  @func()
  ocr(): Service {
    return dag
      .container()
      .from("registry:2")
      .withExposedPort(5000)
      .asService();
  }

  /**
   * Local PyPI mirror for air-gapped builds.
   * Uses pypiserver via uv on the official uv Alpine image.
   * Consumers should set UV_INDEX_URL=http://<endpoint>/simple/ and
   * UV_INSECURE_HOST=<host>:<port> to route installs through this mirror.
   */
  @func()
  pipMirror(): Service {
    return dag
      .container()
      .from("ghcr.io/astral-sh/uv:alpine")
      .withExec(["mkdir", "-p", "/data/packages"])
      .withExposedPort(3141)
      .asService({
        args: [
          "uv", "run", "--with", "pypiserver", "--with", "gunicorn",
          "pypi-server", "run", "--server", "gunicorn", "-p", "3141", "-a", ".", "-P", ".", "/data/packages",
        ],
      });
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
