/**
 * CI pipelines — Bazel build, test, and shell inside eclipse/score-devcontainer.
 *
 * All three entry points share a private buildContainer() helper that:
 *   1. Starts from the repo's devcontainer image (default: eclipse/score-devcontainer)
 *   2. Mounts source/<repoName> at /workspace
 *   3. Applies per-repo extraEnv from RepoConfig
 *   4. Runs repo.preBuildScript if set
 *   5. Binds optional infrastructure services (bazelCache, pipMirror)
 *
 * Per-repo customisation lives entirely in repos.ts (targets, flags, hooks,
 * image overrides). This file must never contain if (repo.name === "...") branches.
 *
 * Service injection notes:
 *   bazelCache  — sets --remote_cache=<endpoint> via BAZEL_REMOTE_CACHE env var
 *                 consumed by .bazelrc: build --remote_cache=%{BAZEL_REMOTE_CACHE}
 *   pipMirror   — sets PYPI_INDEX_URL and UV_INDEX_URL for rules_python/uv resolvers
 *   otel        — TODO: in-container tracing requires dag.host().service([PortForward(...)])
 *                 not yet available in Dagger v0.20.x TypeScript SDK; see otel.ts
 *
 * Usage (CLI):
 *   dagger call build --repo score-base --source <workspace-dir>
 *   dagger call test  --repo score-base --source <workspace-dir>
 *   dagger call shell --repo score-base --source <workspace-dir>
 */
import { dag, Container, Directory, Service } from "@dagger.io/dagger";
import { RepoConfig, getRepo, DEFAULT_DEVCONTAINER } from "./repos.js";

export interface CiOpts {
  repo: string;
  source: Directory;
  otel?: Service;
  bazelCache?: Service;
  pipMirror?: Service;
}

// ── Public entry points ────────────────────────────────────────────────────

export async function bazelBuild(opts: CiOpts): Promise<string> {
  const config = getRepo(opts.repo);
  const ctr = await buildContainer(config, opts.source, opts);
  return ctr
    .withExec([
      "bazel", "build",
      ...config.bazel.buildTargets,
      ...(config.bazel.buildFlags ?? []),
    ])
    .stdout();
}

export async function bazelTest(opts: CiOpts): Promise<string> {
  const config = getRepo(opts.repo);
  const ctr = await buildContainer(config, opts.source, opts);
  return ctr
    .withExec([
      "bazel", "test",
      ...config.bazel.testTargets,
      ...(config.bazel.testFlags ?? []),
    ])
    .stdout();
}

export function bazelShell(opts: Pick<CiOpts, "repo" | "source">): Container {
  const config = getRepo(opts.repo);
  const image = config.devcontainerImage ?? DEFAULT_DEVCONTAINER;
  return dag
    .container()
    .from(image)
    .withDirectory("/workspace", opts.source.directory(config.name))
    .withWorkdir("/workspace")
    .terminal();
}

// ── Shared container builder ───────────────────────────────────────────────

async function buildContainer(
  config: RepoConfig,
  source: Directory,
  services: Pick<CiOpts, "otel" | "bazelCache" | "pipMirror">,
): Promise<Container> {
  const image = config.devcontainerImage ?? DEFAULT_DEVCONTAINER;

  let ctr = dag
    .container()
    .from(image)
    .withDirectory("/workspace", source.directory(config.name))
    .withWorkdir("/workspace");

  // Per-repo extra environment variables
  for (const [key, value] of Object.entries(config.extraEnv ?? {})) {
    ctr = ctr.withEnvVariable(key, value);
  }

  // Bazel remote cache — sets BAZEL_REMOTE_CACHE consumed by .bazelrc
  if (services.bazelCache) {
    const cacheEndpoint = await services.bazelCache.endpoint({ scheme: "http" });
    ctr = ctr
      .withServiceBinding("bazel-cache", services.bazelCache)
      .withEnvVariable("BAZEL_REMOTE_CACHE", cacheEndpoint);
  }

  // PyPI mirror — routes rules_python and uv package resolution offline
  if (services.pipMirror) {
    const mirrorEndpoint = await services.pipMirror.endpoint({ scheme: "http" });
    const mirrorPort = mirrorEndpoint.split(":").pop()!;
    ctr = ctr
      .withServiceBinding("pip-mirror", services.pipMirror)
      .withEnvVariable("PYPI_INDEX_URL", `http://pip-mirror:${mirrorPort}/simple/`)
      .withEnvVariable("UV_INDEX_URL", `http://pip-mirror:${mirrorPort}/simple/`)
      .withEnvVariable("UV_INSECURE_HOST", `pip-mirror:${mirrorPort}`);
  }

  // TODO: OTel in-container tracing (bind host collector port into container)
  // Requires dag.host().service([PortForward(...)]) — not available in v0.20.x.
  // Track in otel.ts; wire here once the TS SDK exposes it.

  // Per-repo pre-build hook
  if (config.preBuildScript) {
    ctr = ctr.withExec(["sh", "-c", config.preBuildScript]);
  }

  return ctr;
}
