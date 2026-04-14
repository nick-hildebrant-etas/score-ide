/**
 * Scorenado pipeline functions — root module manifest.
 *
 * This file is intentionally thin: it declares the Dagger API surface and
 * delegates every implementation to a domain module. Add logic here only
 * when it cannot belong to any domain module.
 *
 * Domain modules:
 *   repos.ts      — repo registry (RepoConfig, REPOS, getRepo)
 *   setup.ts      — multi-repo checkout and branch management
 *   ci.ts         — Bazel build / test / shell (parameterised by RepoConfig)
 *   otel.ts       — OTel Web UI service + smoke test
 *   registry.ts   — OCI container registry service + smoke test
 *   pip-mirror.ts — PyPI mirror service + smoke test
 *   bazel.ts      — Bazel remote cache service (+ future BuildBarn services)
 *
 * CLI quick reference:
 *   dagger call setup --branch main
 *   dagger call build --repo score-base --source <workspace>
 *   dagger call test  --repo score-base --source <workspace>
 *   dagger call shell --repo score-base --source <workspace>
 *   dagger call test-otel --otel tcp://localhost:4318
 *   dagger call test-ocr  --ocr  tcp://localhost:5000
 *   dagger call test-pypi --pip-mirror tcp://localhost:3141
 *   dagger call otel-webui up
 *   dagger call ocr up
 *   dagger call pip-mirror up
 *   dagger call bazel-remote-cache up
 */
import {
  Container,
  Directory,
  Service,
  object,
  func,
} from "@dagger.io/dagger";
import { otelWebuiService, smokeTestOtel } from "./otel.js";
import { ociRegistryService, smokeTestOcr } from "./registry.js";
import { pipMirrorService, smokeTestPypi } from "./pip-mirror.js";
import { bazelRemoteCacheService } from "./bazel.js";
import { setupWorkspace } from "./setup.js";
import { bazelBuild, bazelTest, bazelShell } from "./ci.js";

@object()
export class ScorenadoPipelines {
  // ── Workspace setup ────────────────────────────────────────────────────────

  /**
   * Check out one or more repos at the specified branch and assemble a
   * workspace Directory. Pass the result as --source to build/test/shell.
   *
   * @param branch       Branch to check out in every requested repo.
   * @param repos        Comma-separated repo names; omit for all repos.
   * @param createBranch Create the branch from defaultBranch if it does not
   *                     exist on the remote (respects per-repo policy).
   */
  @func()
  async setup(
    branch: string,
    repos?: string,
    createBranch?: boolean,
  ): Promise<Directory> {
    return setupWorkspace({ branch, repos, createBranch });
  }

  // ── CI pipelines ───────────────────────────────────────────────────────────

  /**
   * Build a repo with Bazel inside eclipse/score-devcontainer.
   * source should be the Directory returned by the setup pipeline.
   */
  @func()
  async build(
    repo: string,
    source: Directory,
    otel?: Service,
    bazelCache?: Service,
    pipMirror?: Service,
  ): Promise<string> {
    return bazelBuild({ repo, source, otel, bazelCache, pipMirror });
  }

  /**
   * Test a repo with Bazel inside eclipse/score-devcontainer.
   * source should be the Directory returned by the setup pipeline.
   */
  @func()
  async test(
    repo: string,
    source: Directory,
    otel?: Service,
    bazelCache?: Service,
    pipMirror?: Service,
  ): Promise<string> {
    return bazelTest({ repo, source, otel, bazelCache, pipMirror });
  }

  /**
   * Open an interactive shell inside the eclipse/score-devcontainer for a repo.
   * source should be the Directory returned by the setup pipeline.
   */
  @func()
  shell(repo: string, source: Directory): Container {
    return bazelShell({ repo, source });
  }

  /**
   * End-to-end smoke test for the OTel service binding path.
   *
   * Expected usage:
   *   dagger call test-otel --otel tcp://localhost:4318
   */
  @func()
  async testOtel(otel: Service): Promise<string> {
    return smokeTestOtel(otel);
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
    return smokeTestOcr(ocr);
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
    return smokeTestPypi(pipMirror);
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
    return otelWebuiService();
  }

  /**
   * Local OCI container registry (Docker registry v2).
   * Consumers push/pull images via tcp://<host>:5000.
   */
  @func()
  ocr(): Service {
    return ociRegistryService();
  }

  /**
   * Local PyPI mirror for air-gapped builds.
   * Uses pypiserver via uv on the official uv Alpine image.
   * Consumers should set UV_INDEX_URL=http://<endpoint>/simple/ and
   * UV_INSECURE_HOST=<host>:<port> to route installs through this mirror.
   */
  @func()
  pipMirror(): Service {
    return pipMirrorService();
  }

  /**
   * Bazel remote cache over HTTP.
   * TODO: Replace with real buchgr/bazel-remote instance.
   */
  @func()
  bazelRemoteCache(): Service {
    return bazelRemoteCacheService();
  }
}
