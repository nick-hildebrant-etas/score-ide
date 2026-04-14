# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile        # one-shot TypeScript build → out/
npm run watch          # incremental watch build (used by F5 debugger)
npm run lint           # ESLint
npm test               # compile + lint + run vscode-test suite
```

Press **F5** in VS Code to launch the Extension Development Host (opens `score-ide.code-workspace` as the workspace so `vscode.workspace.workspaceFolders` is populated).

## Architecture

This is a VS Code extension with two sidebar panels: a **Dagger Pipelines** panel for running CI pipeline functions, and a **Services** panel for managing long-running Dagger services (collectors, caches, sidecars).

### Source files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Extension entry point, command registration, `DaggerPipelinesProvider` |
| `src/servicesProvider.ts` | `ServicesProvider` — manages service lifecycle and output channels |
| `src/services.ts` | `SERVICES` constant — declares available services (id, label, daggerFn, ports, envVars) |

### Extension entry point (`src/extension.ts`)

- **`DaggerPipelinesProvider`** — `TreeDataProvider` that shells out to `dagger functions --progress plain` in the configured pipelines directory, strips ANSI escape codes from stdout, parses the plain-text table, and returns `PipelineItem` nodes.
- **`PipelineItem`** — `TreeItem` with `contextValue = 'pipeline'`; the inline ▶ button is wired via `package.json` menus.
- **`score-ide.runPipeline`** — prompts for a repo ID then sends `dagger call <fn> --repo <id> --source .` to a new terminal. Injects env vars from any running services (e.g. `OTEL_EXPORTER_OTLP_ENDPOINT`) so Dagger's engine-level tracing flows to the collector automatically.
- **`score-ide.refreshPipelines`** — fires `onDidChangeTreeData` to re-run discovery.
- **`score-ide.openServiceBrowser`** — opens `http://localhost:<port>` for the selected service in VS Code's simple browser (`simpleBrowser.api.open`).
- Config change listener: re-runs discovery when `score-ide.pipelinesDir` changes.

### Services provider (`src/servicesProvider.ts`)

- **`ServicesProvider`** — `TreeDataProvider` over `SERVICES`; manages a `Map<id, ServiceState>` (stopped / starting / running / stopping).
- **`startService`** — spawns `dagger call <daggerFn> up` as a child process. Stdout and stderr (ANSI-stripped) stream to a dedicated `vscode.OutputChannel` per service.
- **`stopService`** — sends `SIGTERM` to the child process; Dagger cleans up the service container.
- **`bindEnv`** — returns merged `envVars` from all currently running services, injected into pipeline terminals.
- **`bindServiceArgs`** — returns `--<daggerArg> tcp://<host>:<port>` pairs for every running service that declares a `daggerArg`. Injected into `dagger call` commands so pipeline functions receive the service as a Dagger `Service` argument.
- Icons change with state: `debug-start` (stopped), `loading~spin` (starting/stopping), `circle-filled` (running).

### `package.json` contributions

- **Views**: `score-ide.pipelinesView` and `score-ide.servicesView` inside the `score-ide-sidebar` activity-bar container.
- **Commands**:
  - `score-ide.runPipeline` — inline ▶, only when `viewItem == pipeline`
  - `score-ide.refreshPipelines` — title bar of pipelines view
  - `score-ide.startService` — inline, only when `viewItem == service-stopped`
  - `score-ide.stopService` — inline, only when `viewItem == service-running`
  - `score-ide.refreshServices` — title bar of services view
  - `score-ide.openServiceBrowser` — inline `$(open-preview)`, only when `viewItem == service-running`
- **Setting**: `score-ide.pipelinesDir` — path relative to workspace root containing `dagger.json`. Empty = workspace root.

### Dagger module (`pipelines/`)

A TypeScript Dagger SDK module (dagger v0.20.5, `dagger.json` + `src/index.ts`) with pipeline functions and service functions:

**Pipeline functions:**

| Dagger function | Equivalent Makefile target |
|-----------------|---------------------------|
| `build`         | `make build/<repo>`        |
| `test`          | `make test/<repo>`         |
| `shell`         | `make shell/<repo>`        |

**Service functions** (exposed via `dagger call <fn> up`):

| Dagger function      | Port | Description |
|----------------------|------|-------------|
| `otel-webui`         | 4318 | OTel collector + web UI (`ghcr.io/metafab/otel-gui`) |
| `ocr`                | 8080 | OCR sidecar (hashicorp/http-echo stub) |
| `pip-mirror`         | 3141 | PyPI mirror stub (Python http.server, PEP 503 simple index) |
| `bazel-remote-cache` | 9090 | Bazel remote cache stub (Python http.server) |

**Smoke-test pipeline functions** (prove service-to-pipeline wiring):

| Dagger function | Service arg    | What it checks |
|-----------------|----------------|----------------|
| `test-otel`     | `--otel`       | OTel endpoint reachable via `svc.endpoint()` + `dag.http()` |
| `test-ocr`      | `--ocr`        | OCR endpoint returns `{"status":"ok"}` |
| `test-pypi`     | `--pip-mirror` | Mirror `/simple/` returns PEP 503 `Simple index` HTML |

The `score-ide.code-workspace` file sets `score-ide.pipelinesDir` to `"pipelines"` so F5 works out of the box.

> **Important:** For workspace-file-based setups (`.code-workspace`), the setting must live inside the workspace file under `"settings"` — not in `.vscode/settings.json`, which is only read for single-folder workspaces.

### Service → pipeline wiring

Services started from the panel are passed to pipeline functions as Dagger `Service` arguments via `tcp://<host>:<port>`. Key rules — see `AGENTS-service-pipelines.md` for full history:

1. **Never use `localhost` as the service host in DinD.** The Dagger engine runs inside Docker; `localhost` resolves to the engine container's loopback, not the devcontainer. Use the routable host IP (e.g. `172.17.0.x`) or `host-gateway`. The extension resolves this automatically; override with `SCORE_IDE_SERVICE_HOST`.

2. **Pipeline functions must filter incoming service args.** Each Dagger function only accepts its declared args. Injecting all running service flags into every `dagger call` causes `unknown flag` errors. The extension filters per-function by inspecting `dagger call <fn> --help`.

3. **Use `svc.endpoint({ scheme: "http" })` + `dag.http(endpoint)` inside pipeline functions**, not hardcoded alias ports. The tunneled endpoint port may differ from the container's exposed port.

4. **Service functions use `.asService({ args: [...] })`**, not `withEntrypoint` + `asService()`. `withExec` is build-time only and must not be used to start long-lived processes.

5. **Never use `Container.publish` to smoke-test a service-backed registry.** `publish` runs at the Dagger engine level outside any service-binding context, so the internal hostname from `svc.endpoint()` is not DNS-resolvable. Dagger v0.20.x also removed `allowInsecure` from `ContainerPublishOpts`, so bare-HTTP registries always fail. Use `dag.http(endpoint + "/v2/").contents()` instead — it runs inside the service network and works with HTTP.

### Devcontainer

Docker-in-Docker is provided by the `ghcr.io/devcontainers/features/docker-in-docker:2` feature declared in `devcontainer.json`. `post-create.sh` installs the Docker CLI (if not already present), installs the Dagger CLI to `~/.local/bin`, runs `npm install`, and installs `@anthropic-ai/claude-code`. The `claude-data` volume persists Claude Code auth across rebuilds.
