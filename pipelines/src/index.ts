/**
 * Scorenado pipeline functions
 *
 * Mirrors the three core Scorenado Makefile targets so they can be
 * driven from the score-ide VS Code extension via `dagger call`.
 *
 * Usage (CLI):
 *   dagger call build --repo my-service --source .
 *   dagger call test  --repo my-service --source .
 *   dagger call shell --repo my-service --source .
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
import { dag, Container, Directory, Service, object, func } from "@dagger.io/dagger";

@object()
export class ScorenadoPipelines {
  // ── Pipeline functions ─────────────────────────────────────────────────────

  // TODO: Implement real build logic.
  // This should mirror `make build/<repo>` / `dagger run uv run --script scripts/build.py --repo <repo>`
  // from the Scorenado Makefile. The container needs the repo's toolchain, the
  // source tree mounted, and the Scorenado catalog/secrets available so the
  // generated targets.mk build steps can run.
  @func()
  async build(repo: string, source: Directory): Promise<string> {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec(["bash", "-c", `echo '>>> Building repo: ${repo}' && echo 'Done.'`])
      .stdout();
  }

  // TODO: Implement real test logic.
  // This should mirror `make test/<repo>` / `dagger run uv run --script scripts/test.py --repo <repo>`
  // from the Scorenado Makefile. Same container setup as build; the test runner
  // (pytest or repo-specific) needs to be invoked and its exit code surfaced so a
  // non-zero result fails the Dagger step.
  @func()
  async test(repo: string, source: Directory): Promise<string> {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec(["bash", "-c", `echo '>>> Testing repo: ${repo}' && echo 'All tests passed.'`])
      .stdout();
  }

  // TODO: Implement real shell logic.
  // This should mirror `make shell/<repo>` / `dagger run uv run --script scripts/shell.py --repo <repo>`
  // from the Scorenado Makefile. The container should have the repo's full dev
  // toolchain installed (same image as build/test) so the interactive shell is
  // actually useful for debugging.
  @func()
  shell(repo: string, source: Directory): Container {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withEnvVariable("REPO", repo)
      .terminal();
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
   * OCR sidecar service.
   */
  @func()
  ocr(): Service {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withExposedPort(8080)
      .withExec(["bash", "-c", "echo 'OCR service placeholder' && sleep infinity"])
      .asService();
  }

  /**
   * Local PyPI mirror for air-gapped builds.
   */
  @func()
  pipMirror(): Service {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withExposedPort(3141)
      .withExec(["bash", "-c", "echo 'pip-mirror placeholder' && sleep infinity"])
      .asService();
  }

  /**
   * Bazel remote cache over HTTP.
   */
  @func()
  bazelRemoteCache(): Service {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withExposedPort(9090)
      .withExec(["bash", "-c", "echo 'bazel-remote-cache placeholder' && sleep infinity"])
      .asService();
  }
}
