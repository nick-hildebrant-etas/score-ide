# score-ide

A VS Code extension that surfaces [Dagger](https://dagger.io) pipeline functions as a clickable sidebar panel — a developer-friendly UI layer over `dagger functions` / `dagger call` for the [Scorenado](https://github.com/nick-hildebrant-etas/scorenado) multi-repo CI harness.

## Features

- **Pipeline discovery** — automatically lists all functions exported by a Dagger TypeScript module
- **One-click run** — inline ▶ button on each function opens a terminal and runs `dagger call <fn> --repo <id> --source .`
- **Refresh** — title-bar refresh button re-runs discovery without reloading the window

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

Click the ▶ button next to any function in the **Score IDE** sidebar panel. You'll be prompted for a repo ID, then a terminal opens and runs:

```
dagger call <function> --repo <id> --source .
```

## The `pipelines/` module

This repo includes a reference Dagger TypeScript module in `pipelines/` with three functions that mirror Scorenado's core Makefile targets:

| Function | Equivalent           | Description                          |
|----------|----------------------|--------------------------------------|
| `build`  | `make build/<repo>`  | Build a repository's toolchain       |
| `test`   | `make test/<repo>`   | Run a repository's test suite        |
| `shell`  | `make shell/<repo>`  | Open an interactive shell in the container |

## Development

```bash
npm run compile   # build once
npm run watch     # watch mode (used by F5)
npm run lint      # ESLint
npm test          # compile + lint + run test suite
```

Press **F5** to launch the Extension Development Host. It opens `score-ide.code-workspace`, which already has `score-ide.pipelinesDir` set to `"pipelines"`, so the sidebar populates immediately.
