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
 *   dagger call smoke-otel
 *   dagger call smoke-ocr
 *   dagger call smoke-pypi
 *   dagger call smoke-bazel-cache
 *   dagger call test-otel --otel tcp://localhost:4318
 *   dagger call test-ocr  --ocr  tcp://localhost:5000
 *   dagger call test-pypi --pip-mirror tcp://localhost:3141
 *   dagger call test-bazel-cache --bazel-cache tcp://localhost:9090
 *   dagger call otel-webui up
 *   dagger call ocr up
 *   dagger call pip-mirror up
 *   dagger call bazel-remote-cache up
 */
import {
  Container,
  Directory,
  Service,
  dag,
  object,
  func,
} from "@dagger.io/dagger";
import { otelWebuiService, smokeTestOtel } from "./otel.js";
import { ociRegistryService, smokeTestOcr } from "./registry.js";
import { pipMirrorService, smokeTestPypi } from "./pip-mirror.js";
import { bazelRemoteCacheService, smokeTestBazelCache } from "./bazel.js";
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
   * Verify the OTel service injected by the extension is reachable.
   * Uses svc.endpoint() + dag.http() — works against real TCP tunnels from the extension.
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
   * Verify the OCI registry injected by the extension is reachable.
   * Uses svc.endpoint() + dag.http() — works against real TCP tunnels from the extension.
   *
   * Expected usage:
   *   dagger call test-ocr --ocr tcp://localhost:5000
   */
  @func()
  async testOcr(ocr: Service): Promise<string> {
    const endpoint = await ocr.endpoint({ scheme: "http" });
    await dag.http(`${endpoint}/v2/`).contents();
    return "ocr registry reachable";
  }

  /**
   * Verify the PyPI mirror injected by the extension serves a valid index.
   * Uses svc.endpoint() + dag.http() — works against real TCP tunnels from the extension.
   *
   * Expected usage:
   *   dagger call test-pypi --pip-mirror tcp://localhost:3141
   */
  @func()
  async testPypi(pipMirror: Service): Promise<string> {
    const endpoint = await pipMirror.endpoint({ scheme: "http" });
    const body = await dag.http(`${endpoint}/simple/`).contents();
    if (!body.toLowerCase().includes("simple index")) {
      throw new Error(`pip-mirror /simple/ did not return PEP 503 index: ${body}`);
    }
    return "pip-mirror: /simple/ returns PEP 503 Simple index";
  }

  /**
   * Verify the Bazel remote cache injected by the extension is reachable.
   * Uses svc.endpoint() + dag.http() — works against real TCP tunnels from the extension.
   *
   * Expected usage:
   *   dagger call test-bazel-cache --bazel-cache tcp://localhost:9090
   */
  @func()
  async testBazelCache(bazelCache: Service): Promise<string> {
    const endpoint = await bazelCache.endpoint({ scheme: "http" });
    const body = await dag.http(`${endpoint}/status`).contents();
    if (!body.includes('"state"')) {
      throw new Error(`bazel-remote-cache /status unexpected response: ${body}`);
    }
    return "bazel-remote-cache: /status ok";
  }

  // ── Self-contained smoke tests (service lifecycle managed by Dagger) ─────────

  /** Start otel-webui and verify it responds. No external service needed. */
  @func()
  async smokeOtel(): Promise<string> {
    return smokeTestOtel(otelWebuiService());
  }

  /** Start ocr registry and verify /v2/ responds. No external service needed. */
  @func()
  async smokeOcr(): Promise<string> {
    return smokeTestOcr(ociRegistryService());
  }

  /** Start pip-mirror and verify /simple/ responds. No external service needed. */
  @func()
  async smokePypi(): Promise<string> {
    return smokeTestPypi(pipMirrorService());
  }

  /** Start bazel-remote-cache and verify /status responds. No external service needed. */
  @func()
  async smokeBazelCache(): Promise<string> {
    return smokeTestBazelCache(bazelRemoteCacheService());
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
