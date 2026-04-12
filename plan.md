# Plan: Services Panel

A second panel in the score-ide sidebar that starts and stops long-running local
services used by pipeline builds. Services are OCI containers managed as Dagger
services; the panel is a peer of the existing Pipelines panel.

## Services in scope

| Service            | Dagger function      | Purpose                                    |
|--------------------|----------------------|--------------------------------------------|
| `otel-webui`       | `otel-webui`         | OpenTelemetry collector + web UI; pipelines bind to it to emit traces |
| `ocr`              | `ocr`                | OCR sidecar                                |
| `pip-mirror`       | `pip-mirror`         | Local PyPI mirror for air-gapped builds    |
| `bazel-remote-cache` | `bazel-remote-cache` | Bazel remote cache over HTTP            |

---

## Architecture

### 1. Service definitions (static, in `src/services.ts`)

Services are not discovered dynamically — they are a known, fixed set with
well-defined roles. Each entry is a plain object:

```typescript
interface ServiceDef {
  id: string;          // e.g. "otel-webui"
  label: string;       // display name
  daggerFn: string;    // function name passed to `dagger call`
  ports: number[];     // host ports to expose (for URL / health-check display)
  bindArg?: string;    // flag name pipelines use to bind to this service,
                       // e.g. "--otel-endpoint" → "http://localhost:4317"
}
```

The static list lives in `src/services.ts` and is imported by both the provider
and the run-pipeline command.

### 2. Runtime state (in-memory, cleared on window reload)

```typescript
interface ServiceState {
  status: 'stopped' | 'starting' | 'running' | 'stopping';
  terminal?: vscode.Terminal;   // the terminal running `dagger call <fn> up`
  port?: number;                // first port from ServiceDef.ports, shown in UI
}
```

A `Map<string, ServiceState>` keyed by `ServiceDef.id` is held in the
`ServicesProvider` instance. It is the single source of truth; the tree re-renders
whenever any entry changes.

### 3. `ServicesProvider` (`src/extension.ts` or extracted to `src/servicesProvider.ts`)

Implements `vscode.TreeDataProvider<ServiceItem>`. Returns one `ServiceItem` per
`ServiceDef`. `contextValue` is either `'service-stopped'` or `'service-running'`;
the `package.json` menus use these to show the right inline button.

Visual states:

| Status     | Icon (ThemeIcon)   | Description |
|------------|--------------------|-------------|
| stopped    | `$(debug-start)`   | *Stopped*   |
| starting   | `$(loading~spin)`  | *Starting…* |
| running    | `$(circle-filled)` | `localhost:<port>` |
| stopping   | `$(loading~spin)`  | *Stopping…* |

### 4. Start / stop commands

**`score-ide.startService`** (inline ▶, shown when `viewItem == service-stopped`):
1. Set state → `starting`, fire refresh.
2. Open a terminal: `{ name: "svc: <id>", cwd: pipelinesDir, env: { DAGGER_NO_NAG: "1" } }`.
3. Send `dagger call <daggerFn> up --native`.
4. Store the terminal in state, set status → `running`, fire refresh.
5. Register `onDidCloseTerminal` listener: if this terminal closes, set status →
   `stopped` and fire refresh.

**`score-ide.stopService`** (inline ⏹, shown when `viewItem == service-running`):
1. Set state → `stopping`, fire refresh.
2. Call `terminal.dispose()` — Dagger cleans up the service container when its
   `up` process exits.
3. State transitions to `stopped` via the `onDidCloseTerminal` handler above.

No separate "stop" Dagger function is needed; disposing the terminal is sufficient
because `dagger call … up` holds the service alive only while the process runs.

### 5. Pipeline binding

When `score-ide.runPipeline` fires, it checks the state map for any running
service that has a `bindArg`. For each one it appends the flag to the `dagger call`
invocation:

```
dagger call build --repo my-service --source . --otel-endpoint http://localhost:4317
```

This is transparent to the user — binding happens automatically when the service
is up, and is absent when it is not.

### 6. `package.json` additions

**View** — add a second entry under `score-ide-sidebar`:
```json
{
  "id": "score-ide.servicesView",
  "name": "Services",
  "icon": "media/icon.svg"
}
```

**Commands:**
```json
{ "command": "score-ide.startService",  "title": "Start Service",  "icon": "$(debug-start)" },
{ "command": "score-ide.stopService",   "title": "Stop Service",   "icon": "$(debug-stop)"  },
{ "command": "score-ide.refreshServices","title": "Refresh",       "icon": "$(refresh)"     }
```

**Menus:**
```json
{ "command": "score-ide.startService",   "when": "view == score-ide.servicesView && viewItem == service-stopped", "group": "inline" },
{ "command": "score-ide.stopService",    "when": "view == score-ide.servicesView && viewItem == service-running", "group": "inline" },
{ "command": "score-ide.refreshServices","when": "view == score-ide.servicesView", "group": "navigation" }
```

---

## File changes

| File | Change |
|------|--------|
| `src/services.ts` | New — `ServiceDef` interface + static list of four services |
| `src/servicesProvider.ts` | New — `ServicesProvider`, `ServiceItem`, start/stop logic |
| `src/extension.ts` | Register `ServicesProvider` and three new commands; thread state into `runPipeline` bind logic |
| `package.json` | Second view, three commands, menu entries |
| `pipelines/src/index.ts` | Expose each service as a Dagger function returning `Service` (see below) |

---

## Dagger module changes (`pipelines/src/index.ts`)

Each service needs a function that returns a running `Service` object. The
pipeline functions that need OTel accept an optional endpoint argument so they can
be called with or without the service running:

```typescript
@func()
otelWebui(): Service {
  return dag.container()
    .from("otel/opentelemetry-collector-contrib:latest")
    // collector + webui config …
    .asService();
}

@func()
async build(repo: string, source: Directory, otelEndpoint?: string): Promise<string> {
  let ctr = dag.container().from("ubuntu:22.04") /* … */;
  if (otelEndpoint) {
    ctr = ctr.withEnvVariable("OTEL_EXPORTER_OTLP_ENDPOINT", otelEndpoint);
  }
  return ctr.stdout();
}
```

Similar optional bind args on `test` and `shell`. The `ocr`, `pip-mirror`, and
`bazel-remote-cache` functions follow the same `asService()` pattern; their bind
args (e.g. `--pip-index-url`, `--bazel-cache-url`) are added to the relevant
pipeline functions as the services are built out.

---

## Out of scope for this plan

- Persisting service state across window reloads (services stop when the extension
  host restarts; restarting them is a one-click action).
- Health-check polling (terminal close is the only signal used for now).
- Port conflict detection.
- Multiple simultaneous instances of the same service.
