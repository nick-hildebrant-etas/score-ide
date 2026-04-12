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

This is a VS Code extension that surfaces Dagger pipeline functions as a clickable sidebar panel — a UI layer over `dagger functions` / `dagger call` for the [Scorenado](https://github.com/nick-hildebrant-etas/scorenado) multi-repo CI harness.

### Extension entry point (`src/extension.ts`)

- **`DaggerPipelinesProvider`** — `TreeDataProvider` that shells out to `dagger functions` in the configured pipelines directory, parses the plain-text table output, and returns `PipelineItem` nodes.
- **`PipelineItem`** — `TreeItem` with `contextValue = 'pipeline'`; the inline ▶ button is wired via `package.json` menus.
- **`score-ide.runPipeline`** — prompts for a repo ID then sends `dagger call <fn> --repo <id> --source .` to a new terminal.
- **`score-ide.refreshPipelines`** — fires `onDidChangeTreeData` to re-run discovery.
- Config change listener: re-runs discovery when `score-ide.pipelinesDir` changes.

### `package.json` contributions

- **View**: `score-ide.pipelinesView` inside the `score-ide-sidebar` activity-bar container.
- **Commands**: `score-ide.runPipeline` (inline play button, only when `viewItem == pipeline`) and `score-ide.refreshPipelines` (title bar).
- **Setting**: `score-ide.pipelinesDir` — path relative to workspace root containing `dagger.json`. Empty = workspace root.

### Dagger module (`pipelines/`)

A TypeScript Dagger SDK module (`dagger.json` + `src/index.ts`) with three functions that mirror Scorenado's Makefile targets:

| Dagger function | Equivalent Makefile target |
|-----------------|---------------------------|
| `build`         | `make build/<repo>`        |
| `test`          | `make test/<repo>`         |
| `shell`         | `make shell/<repo>`        |

The `score-ide.code-workspace` file sets `score-ide.pipelinesDir` to `"pipelines"` so F5 works out of the box.

> **Important:** For workspace-file-based setups (`.code-workspace`), the setting must live inside the workspace file under `"settings"` — not in `.vscode/settings.json`, which is only read for single-folder workspaces.

### Devcontainer

Docker-in-Docker is provided by the `ghcr.io/devcontainers/features/docker-in-docker:2` feature declared in `devcontainer.json`. `post-create.sh` installs the Docker CLI (if not already present), installs the Dagger CLI to `~/.local/bin`, runs `npm install`, and installs `@anthropic-ai/claude-code`. The `claude-data` volume persists Claude Code auth across rebuilds.
