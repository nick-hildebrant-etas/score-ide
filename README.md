# score-ide

A VS Code extension that surfaces [Dagger](https://dagger.io) pipeline functions and long-running dev services as a clickable sidebar panel — a developer-friendly UI layer over `dagger functions` / `dagger call` for the [Scorenado](https://github.com/nick-hildebrant-etas/scorenado) multi-repo CI harness.

## Features

### Dagger Pipelines panel

- **Pipeline discovery** — automatically lists all functions exported by a Dagger TypeScript module
- **One-click run** — inline ▶ button on each function prompts for a repo ID, then opens a terminal running `dagger call <fn> --repo <id> --source .`
- **Refresh** — title-bar refresh button re-runs discovery without reloading the window
- Active service env vars (OTel endpoint, etc.) are automatically injected into the terminal so Dagger's engine-level tracing flows to any running collector

### Services panel

Start and manage long-running Dagger services (collectors, caches, sidecars) without leaving VS Code:

| Service | Port | Description |
|---------|------|-------------|
| OTel Web UI | 4318 | OpenTelemetry collector + web UI (`ghcr.io/metafab/otel-gui`) |
| OCR | 8080 | OCR sidecar service |
| PyPI Mirror | 3141 | pip mirror (devpi) |
| Bazel Remote Cache | 9090 | Bazel remote cache over HTTP |

- **Start / Stop** — inline buttons toggle the service process
- **Open in Browser Preview** — inline `$(open-preview)` button opens the service URL in VS Code's built-in simple browser
- Service output (with ANSI codes stripped) streams to a dedicated Output Channel per service
- When OTel Web UI is running, `OTEL_EXPORTER_OTLP_ENDPOINT` is automatically injected into pipeline terminals

## Requirements

- [Dagger CLI](https://docs.dagger.io/install) installed and on `$PATH`
- Docker (or Docker-in-Docker in a devcontainer)
- A Dagger module in your workspace (initialized with `dagger init --sdk=typescript`)

## Setup

### 1. Point the extension at your Dagger module

Set `score-ide.pipelinesDir` to the path of the directory containing your `dagger.json`, relative to the workspace root.

**In a `.code-workspace` file** (recommended):

```json
{
  "folders": [{ "path": "." }],
  "settings": {
    "score-ide.pipelinesDir": "pipelines"
  }
}
```

**In `.vscode/settings.json`** (single-folder workspaces only):

```json
{
  "score-ide.pipelinesDir": "pipelines"
}
```

Leave the setting empty to use the workspace root.

### 2. Run a pipeline

Click the ▶ button next to any function in the **Dagger Pipelines** panel. You'll be prompted for a repo ID, then a terminal opens and runs:

```
dagger call <function> --repo <id> --source .
```

### 3. Start a service

Click the ▶ button next to any service in the **Services** panel. Output streams to the `Score IDE: <name>` Output Channel. Once running, click the preview icon to open the service in VS Code's browser.

## The `pipelines/` module

This repo includes a reference Dagger TypeScript module in `pipelines/` with functions for both pipeline execution and service management:

**Pipeline functions** (called with `--repo` and `--source`):

| Function | Equivalent           | Description                          |
|----------|----------------------|--------------------------------------|
| `build`  | `make build/<repo>`  | Build a repository's toolchain       |
| `test`   | `make test/<repo>`   | Run a repository's test suite        |
| `shell`  | `make shell/<repo>`  | Open an interactive shell in the container |

**Service functions** (called with `up` via the Services panel):

| Function | Description |
|----------|-------------|
| `otel-webui` | OTel collector + web UI |
| `ocr` | OCR sidecar |
| `pip-mirror` | PyPI mirror |
| `bazel-remote-cache` | Bazel remote cache |

## Development

```bash
npm run compile   # build once
npm run watch     # watch mode (used by F5)
npm run lint      # ESLint
npm test          # compile + lint + run test suite
```

Press **F5** to launch the Extension Development Host. It opens `score-ide.code-workspace`, which already has `score-ide.pipelinesDir` set to `"pipelines"`, so the sidebar populates immediately.
