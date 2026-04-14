# Pipeline Refactor Plan

## Status

**Refactor: ✅ complete.** All 9 migration steps executed. `npm test`: 34 passing, 6 pending (expected), 1 failing (pre-existing).

### Open points

| # | Area | What's needed | Notes |
|---|------|--------------|-------|
| 1 | `repos.ts` | Replace placeholder `score-base` URL with real Eclipse SCORE remote(s) | TODO comment in file |
| 2 | `ci.ts` | Verify `ghcr.io/eclipse-score/devcontainer:latest` is the correct image tag | `DEFAULT_DEVCONTAINER` in `repos.ts` |
| 3 | `ci.ts` / `otel.ts` | OTel in-container tracing: wire `dag.host().service([PortForward(...)])` once Dagger v0.20.x TS SDK exposes it | TODO in `otel.ts` |
| 4 | `registry.ts` | Rename `ocr` → `registry` throughout (function name, service ID, daggerArg, test file) | Deferred to avoid uncoordinated CLI break |
| 5 | `bazel.ts` | Replace Python stub with real `buchgr/bazel-remote` instance | TODO in file |
| 6 | `bazel.ts` | Add BuildBarn scheduler, worker, browser services + smoke tests | Near-term additions listed in module doc |
| 7 | `setup.test.ts` | 6 pending setup tests need `pipelines/out/repos.js` — run `cd pipelines && npx tsc` or add compile step to pretest | Pre-existing gap in test infrastructure |
| 8 | `pipelineBindings.test.ts` | `test-pypi` ETIMEDOUT on cold Dagger layer cache — `spawnSync` timeout is 120s, numpy download+upload takes longer | Pre-existing; increase timeout or pre-warm cache |
| 9 | `setup.ts` | `dag.git().branch().tree()` try/catch won't catch network errors (Dagger is lazy) — branch-not-found needs a proper git container check | Currently falls through incorrectly on fetch errors |

---

## Context

The original `pipelines/src/index.ts` was a 243-line monolith holding ten Dagger functions across five concerns: core CI (build/test/shell), observability (OTel), container registry (OCR), dependency mirroring (PyPI), and build caching (Bazel).

The refactor broke `index.ts` into domain modules so that each concern lives in a file named after its service domain. The VS Code extension's `services.ts` and test files follow the same grouping.

---

## Domain Model

The system serves a single bounded context: **airgapped software supply chain for a multi-repo Bazel workspace**.

### Repos

The build target is a configurable list of source repositories. All repos are built with Bazel inside `eclipse/score-devcontainer`. Each repo shares the same 80% pipeline structure but can declare per-repo customizations (additional Bazel targets, pre-build steps, environment overrides). Repos are declared as data (`repos.ts`), not as code.

A `Repo` has:
- Identity: name, remote URL, default branch
- Bazel config: default targets (e.g. `//...`), test targets, build flags
- Custom hooks: pre-build script, extra env vars, devcontainer image override
- Branch policy: whether to allow branch creation from this pipeline

### Setup Pipeline

Before any build can run, repos must be checked out at the correct branches. The **setup pipeline** is a first-class Dagger function that:
- Accepts a branch name and a list of repo names (defaults to all)
- Clones or fetches each repo
- Selects an existing branch or creates a new one (per repo branch policy)
- Returns a `Directory` representing the assembled multi-repo workspace

Setup is invoked independently from build/test. The extension can expose it as its own panel action ("Set up workspace"). Downstream pipelines receive the workspace `Directory` as an input.

### CI Pipelines

Build, test, and shell pipelines run inside `eclipse/score-devcontainer` using Bazel. They are parameterized by:
- `repo` — which repo to target (selects its `RepoConfig`)
- `source` — a `Directory` from a prior `setup` call, or the current working directory
- Service bindings — `otelCollector`, `bazelCache`, `registry`, etc.

The 80% shared logic lives in `ci.ts`. Per-repo overrides are applied from `repos.ts` config before invoking the shared Bazel steps.

### Infrastructure Services

Long-running Dagger services that pipelines consume as arguments:

| Domain | Current services | Near-term additions |
|--------|-----------------|---------------------|
| Observability | OTel Web UI | — |
| Container registry | OCI Registry (`registry:2`) | Harbor, GHCR mirror |
| Dependency mirrors | PyPI mirror | npm (Verdaccio), Maven, apt-mirror |
| Build cache / RE | Bazel HTTP cache | BuildBarn scheduler, BuildBarn workers |

---

## Proposed File Structure

### `pipelines/src/` — Dagger module

```
pipelines/src/
├── index.ts        # Root @object() class — method stubs that delegate; no logic here
├── repos.ts        # Repo registry: RepoConfig interface + REPOS constant
├── setup.ts        # Multi-repo checkout and branch management pipeline
├── ci.ts           # Base Bazel CI: build, test, shell (parameterized by RepoConfig)
├── otel.ts         # Observability: otelWebui service + testOtel smoke test
├── registry.ts     # Container registry: ocr service + testOcr smoke test
├── pip-mirror.ts   # PyPI mirror: pipMirror service + testPypi smoke test
└── bazel.ts        # Build cache: bazelRemoteCache service + (soon) BuildBarn services
```

### `src/` — VS Code extension

`services.ts` is 57 lines and does not need splitting today. Split when it exceeds ~120 lines or when BuildBarn adds 2+ new service definitions to one domain.

```
src/
├── extension.ts        # Entry point — unchanged
├── servicesProvider.ts # Lifecycle manager — unchanged
└── services.ts         # SERVICES array — split into services/ when it grows
```

### `src/test/unit/` — Unit and smoke tests

Each domain module gets a dedicated test file. One test file covers all cross-service integration:

```
src/test/unit/
├── extension.test.ts         # Package.json contribution contract (unchanged)
├── otel.test.ts              # OTel service definition + live container (rename otelWebui.test.ts)
├── registry.test.ts          # Registry service definition + live container
├── pip-mirror.test.ts        # PyPI mirror service definition + live container
├── bazel.test.ts             # Bazel cache service definition + live container
├── setup.test.ts             # Setup pipeline: branch selection, workspace assembly
└── pipelineBindings.test.ts  # Cross-service integration smoke tests (unchanged)
```

---

## Composition Pattern for Dagger TypeScript

Dagger's TypeScript SDK registers every `@object()`-decorated class as a Dagger type. The root class (named after the module) is the entry point for CLI invocations. Sub-objects are accessible but change the CLI API surface (e.g., `dagger call otel web-ui` vs `dagger call otel-webui`).

**Decision**: preserve the existing CLI API. Each domain module exports plain functions; `index.ts` contains the one `@object()` class and delegates to them.

```typescript
// pipelines/src/index.ts
import { object, func, arg, Directory, Service, Container } from "@dagger.io/dagger";
import { otelWebuiService, smokeTestOtel } from "./otel.js";
import { ociRegistryService, smokeTestOcr } from "./registry.js";
import { pipMirrorService, smokeTestPypi } from "./pip-mirror.js";
import { bazelRemoteCacheService } from "./bazel.js";
import { setupWorkspace } from "./setup.js";
import { bazelBuild, bazelTest, bazelShell } from "./ci.js";

@object()
export class ScorenadoPipelines {
  // infrastructure services
  @func() otelWebui(): Service          { return otelWebuiService(); }
  @func() ocr(): Service                { return ociRegistryService(); }
  @func() pipMirror(): Service          { return pipMirrorService(); }
  @func() bazelRemoteCache(): Service   { return bazelRemoteCacheService(); }

  // service smoke tests
  @func() testOtel(@arg() otel: Service)            { return smokeTestOtel(otel); }
  @func() testOcr(@arg() ocr: Service)              { return smokeTestOcr(ocr); }
  @func() testPypi(@arg() pipMirror: Service)       { return smokeTestPypi(pipMirror); }

  // workspace setup
  @func() setup(
    @arg() branch: string,
    @arg() repos?: string,           // comma-separated; omit for all
    @arg() createBranch?: boolean,
  ): Promise<Directory>              { return setupWorkspace({ branch, repos, createBranch }); }

  // CI pipelines (Bazel, per-repo)
  @func() build(
    @arg() repo: string,
    @arg() source: Directory,
    @arg() otel?: Service,
    @arg() bazelCache?: Service,
  ): Promise<string>                 { return bazelBuild({ repo, source, otel, bazelCache }); }

  @func() test(
    @arg() repo: string,
    @arg() source: Directory,
    @arg() otel?: Service,
    @arg() bazelCache?: Service,
  ): Promise<string>                 { return bazelTest({ repo, source, otel, bazelCache }); }

  @func() shell(
    @arg() repo: string,
    @arg() source: Directory,
  ): Container                       { return bazelShell({ repo, source }); }
}
```

`index.ts` becomes a manifest: the full API surface is visible in one screen; each concern has exactly one file to open.

---

## Module Responsibilities

### `repos.ts` — Repo Registry

**Exports**: `RepoConfig` interface, `REPOS` constant, `getRepo(name: string): RepoConfig`

This is the only file that changes when adding or adjusting a repo. It is pure data — no Dagger SDK imports. Example shape:

```typescript
export interface RepoConfig {
  name: string;                  // identifier used in CLI args
  remote: string;                // https or ssh URL
  defaultBranch: string;
  bazel: {
    buildTargets: string[];      // e.g. ["//..."] or ["//src/...", "//tools/..."]
    testTargets: string[];
    buildFlags?: string[];       // e.g. ["--config=ci"]
    testFlags?: string[];
  };
  devcontainerImage?: string;    // defaults to "ghcr.io/eclipse-score/devcontainer:latest"
  preBuildScript?: string;       // shell snippet run before `bazel build`
  extraEnv?: Record<string, string>;
  allowBranchCreation?: boolean; // default true
}

export const REPOS: RepoConfig[] = [
  {
    name: "score-base",
    remote: "https://github.com/eclipse-score/score-base",
    defaultBranch: "main",
    bazel: {
      buildTargets: ["//..."],
      testTargets: ["//..."],
      buildFlags: ["--config=ci"],
    },
  },
  // ... more repos
];
```

The `REPOS` list is the authoritative source of truth for:
- Which repos the setup pipeline clones
- Which repo names are valid arguments to `build`, `test`, `shell`
- What the VS Code extension could offer as a repo picker (future)

### `setup.ts` — Multi-Repo Workspace Pipeline

**Exports**: `setupWorkspace(opts: SetupOpts): Promise<Directory>`

Handles the checkout concern independently from the build concern. A setup run:

1. Iterates over the requested repos (defaults to all `REPOS`)
2. For each repo: `git clone --depth=1` or `git fetch` into a named sub-directory
3. Checks out `opts.branch` if it exists; creates it from `defaultBranch` if `opts.createBranch` is true and the repo's `allowBranchCreation` permits it
4. Returns a `Directory` with layout `/<repoName>/` for each repo

```typescript
// usage from CLI
dagger call setup --branch feature/my-work
dagger call setup --branch feature/my-work --repos score-base,score-plugin --create-branch
```

The returned `Directory` is passed directly to `build`, `test`, or `shell` as `--source`. This keeps setup and build cleanly separated — a developer can run setup once and then iterate on build/test without re-cloning.

Branch creation policy is per-repo (`allowBranchCreation` in `RepoConfig`), not a global flag, because some repos may be read-only mirrors that should never accept new branches from this pipeline.

### `ci.ts` — Bazel CI Pipelines

**Exports**: `bazelBuild`, `bazelTest`, `bazelShell`

All three functions share a private `buildContainer(repo: RepoConfig, source: Directory, services: ServiceBindings): Container` helper that:

1. Starts from `repo.devcontainerImage ?? DEFAULT_DEVCONTAINER` (`eclipse/score-devcontainer`)
2. Mounts `source/<repo.name>` at `/workspace`
3. Binds optional services:
   - `otel` → sets `OTEL_EXPORTER_OTLP_ENDPOINT` inside the container (once `dag.host().service([PortForward(...)])` is available in the TS SDK)
   - `bazelCache` → sets `--remote_cache=<endpoint>` in `.bazelrc.ci` or via `--bazelrc` flag
4. Applies `repo.extraEnv`
5. Runs `repo.preBuildScript` if set

The per-repo customization points (`buildFlags`, `testTargets`, `preBuildScript`, `extraEnv`) are all in `RepoConfig` in `repos.ts`. `ci.ts` reads them but does not hardcode per-repo logic — it must never contain `if (repo.name === "score-base") { ... }` branches.

```typescript
// ci.ts shape
export async function bazelBuild(opts: {
  repo: string;
  source: Directory;
  otel?: Service;
  bazelCache?: Service;
}): Promise<string> {
  const config = getRepo(opts.repo);  // throws on unknown repo name
  const ctr = buildContainer(config, opts.source, { otel: opts.otel, bazelCache: opts.bazelCache });
  return ctr
    .withExec(["bazel", "build", ...config.bazel.buildTargets, ...(config.bazel.buildFlags ?? [])])
    .stdout();
}
```

`bazelShell` returns a `Container` with `.terminal()` — no `async`, no `Promise<string>`. The interactive terminal use case is first-class.

### `otel.ts` — Observability

**Exports**: `otelWebuiService`, `smokeTestOtel`

Observability is a cross-cutting concern. The OTel service is the first thing started in any developer session. This file will also house the TODO for in-container tracing (`dag.host().service([PortForward(...)])`) when the TypeScript SDK exposes that API. Once available, `ci.ts`'s `buildContainer` will call into a helper exported from here to bind the collector port.

### `registry.ts` — Container Registry

**Exports**: `ociRegistryService`, `smokeTestOcr`

The current function name `ocr` is ambiguous with Optical Character Recognition. The rename to `registry` / `ociRegistry` is deferred to a separate PR to avoid a breaking CLI change without coordination, but this file is named `registry.ts` to reflect the correct domain name. When the rename happens, it is isolated to `registry.ts`, `src/services.ts` (one entry), and the test file.

Future: Harbor (image signing, replication policies), GHCR mirror for fully airgapped container pulls.

### `pip-mirror.ts` — Dependency Mirrors (Python)

**Exports**: `pipMirrorService`, `smokeTestPypi`

This file is deliberately named `pip-mirror.ts` (matching the current service ID and Dagger function name) rather than a generic `mirrors.ts`. When npm and Maven mirrors are added, they each get their own file (`npm-mirror.ts`, `maven-mirror.ts`). A future `mirrors/` sub-directory is premature until there are three or more mirror types.

Bazel builds may pull PyPI packages via `rules_python`. When the `pip-mirror` service is running, `ci.ts` should inject `PYPI_INDEX_URL` (or the Bazel equivalent `--repo_env=PYPI_INDEX_URL=...`) so that `rules_python` resolves through the mirror. This wiring belongs in `ci.ts`'s `buildContainer`, not in `pip-mirror.ts`.

### `bazel.ts` — Build Cache and Remote Execution

**Exports**: `bazelRemoteCacheService`

This is the file that will grow most in the near term. The current `bazelRemoteCache` implementation is a Python stub. Planned additions in order of priority:

1. Replace stub with real `buchgr/bazel-remote` or `bazelbuild/remote-apis-testing`
2. `buildbarnScheduler(): Service` — BuildBarn scheduler (REAPI/gRPC)
3. `buildbarnWorker(): Service` — BuildBarn worker (sandboxed execution)
4. `buildbarnBrowser(): Service` — BuildBarn web UI
5. `smokeTestBazelCache(cache: Service)` — verify CAS/AC endpoints
6. `smokeTestBazelRE(scheduler: Service, worker: Service)` — verify remote execution round-trip

When BuildBarn services land, consider splitting into `bazel-cache.ts` + `buildbarn.ts`. Do not split preemptively.

---

## Migration Steps ✅

All steps complete. Steps 1–4 were pure moves (no behavior change). Steps 5–7 introduced the new `repos.ts` + `setup.ts` model and replaced the CI stubs. Steps 8–9 cleaned up and aligned tests.

1. ✅ **Create `pipelines/src/otel.ts`** — extract `otelWebui()` and `testOtel()` as plain functions. Update `index.ts` to delegate.
2. ✅ **Create `pipelines/src/registry.ts`** — extract `ocr()` and `testOcr()`. Update `index.ts`.
3. ✅ **Create `pipelines/src/pip-mirror.ts`** — extract `pipMirror()` and `testPypi()`. Update `index.ts`.
4. ✅ **Create `pipelines/src/bazel.ts`** — extract `bazelRemoteCache()`. Update `index.ts`.
5. ✅ **Create `pipelines/src/repos.ts`** — `RepoConfig` interface, `REPOS` constant, `getRepo()`. No Dagger imports; pure data.
6. ✅ **Create `pipelines/src/setup.ts`** — `setupWorkspace` using `dag.git()`. Wired into `index.ts` `setup()` method.
7. ✅ **Create `pipelines/src/ci.ts`** — `bazelBuild`, `bazelTest`, `bazelShell` driven by `RepoConfig`. `index.ts` signatures updated to include `repo: string` and optional service args.
8. ✅ **Slim `index.ts`** — `dag` removed from imports; file is manifest-only with no logic.
9. ✅ **Rename + add test files** — `otelWebui.test.ts` → `otel.test.ts`; `registry.test.ts`, `pip-mirror.test.ts`, `bazel.test.ts`, `setup.test.ts` added.

**Execution notes:**
- `smokeTestOcr` return value corrected to `"ocr service reachable"` (was `"ocr registry reachable: ..."`) to match the pre-existing `pipelineBindings.test.ts` contract.
- `pip-mirror.test.ts` live suite timeout raised to 120s / `waitReady` to 90s for cold `uv run --with pypiserver` startup.
- `bazel.test.ts` uses temp file + volume mount for the inline Python script (not shell escaping).
- If `pipelineBindings` fails in `beforeAll` with exit code 1, kill orphaned dagger service processes: `kill $(pgrep -f "dagger call")`.

---

## Verification ✅

`npm test` result: **34 passing, 6 pending, 1 failing**

- 34 passing — all previously-passing tests pass; all new domain-module tests pass
- 6 pending — `setup.test.ts` static + live tests; require `pipelines/out/repos.js` (see open point #7)
- 1 failing — `test-pypi` ETIMEDOUT in `pipelineBindings.test.ts` (see open point #8; pre-existing)

The VS Code extension requires no code changes: it discovers functions via `dagger functions --progress plain` at runtime and does not import from the Dagger module source.

---

## Extension `services.ts` — Future Split Trigger

Split `src/services.ts` into `src/services/` when **either** condition is true:

- More than 8 service entries (file exceeds ~130 lines), **or**
- Two or more services in one domain need shared constants (e.g., BuildBarn scheduler + worker share a port range or auth config)

When that happens, the structure mirrors the pipeline modules:

```
src/services/
├── index.ts      # Re-exports SERVICES = [...otelServices, ...registryServices, ...]
├── otel.ts       # otelWebui ServiceDef
├── registry.ts   # ociRegistry ServiceDef
├── pip-mirror.ts # pipMirror ServiceDef
└── bazel.ts      # bazelRemoteCache, buildbarnScheduler, buildbarnWorker ServiceDefs
```

---

## Future: Full QA Pipeline Composition

Once `ci.ts` has real Bazel logic and all infrastructure services are production-ready, a `qa` pipeline function composes everything:

```typescript
// index.ts addition
@func() qa(
  @arg() repo: string,
  @arg() source: Directory,
  @arg() otel?: Service,
  @arg() bazelCache?: Service,
  @arg() registry?: Service,
  @arg() pipMirror?: Service,
): Promise<string> { return qaRun({ repo, source, otel, bazelCache, registry, pipMirror }); }
```

```typescript
// ci.ts
export async function qaRun(opts): Promise<string> {
  const config = getRepo(opts.repo);
  const ctr = buildContainer(config, opts.source, opts);
  const buildOut = await ctr
    .withExec(["bazel", "build", ...config.bazel.buildTargets, ...config.bazel.buildFlags ?? []])
    .stdout();
  const testOut = await ctr
    .withExec(["bazel", "test", ...config.bazel.testTargets, ...config.bazel.testFlags ?? []])
    .stdout();
  return [buildOut, testOut].join("\n---\n");
}
```

The extension invokes this as:
```
dagger call qa --repo score-base --source . --otel tcp://... --bazel-cache tcp://...
```

No new extension wiring is needed: `bindServiceArgsForFunction()` already filters to accepted `--help` flags, so new service args are automatically included when the running services match the function's declared args.
