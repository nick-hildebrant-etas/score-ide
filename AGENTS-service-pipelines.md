# Service-Pipeline Communication Runbook (score-ide)

This file captures what was tried, what failed, and what is now known to work for
connecting extension-started Dagger services to pipeline functions.

## Objective

When a service is running from the Services panel, pipeline functions should be
able to consume it via Dagger Service args, and smoke tests should pass in the
mocha test environment.

## Final working design

1. Services are started from the extension with `dagger call <service-fn> up`.
2. The extension injects service args into `dagger call <pipeline-fn> ...`.
3. Service args are filtered per pipeline function, so only supported flags are sent.
4. Pipeline smoke functions use `Service.endpoint(...)` and `dag.http(...)`, not
   hardcoded alias ports (`http://alias:4318`).
5. Mocha smoke tests use dedicated host ports and can reuse already-running tunnels.

## Incorrect approaches (explicitly flagged)

### INCORRECT: Pass all running service flags to every pipeline

Example failure:

- `test-otel` received `--ocr` and errored with `unknown flag: --ocr`
- `test-ocr` received `--otel` and errored with `unknown flag: --otel`

Why wrong:

- Each Dagger function accepts only its declared args.

Fix:

- Parse `dagger call <fn> --help` and inject only accepted flags.

### INCORRECT: Use self-contained internal services to "prove" host wiring

Example:

- A pipeline function calling `this.ociRegistry()` internally passed even if the
  extension service was not running.

Why wrong:

- It does not validate host-to-pipeline service handoff at all.

Fix:

- Pipeline functions must consume `Service` args passed via CLI.

### INCORRECT: Assume hardcoded alias port in bound container

Example:

- Function received `--otel tcp://...:14318` but still curled `http://otel:4318`.

Why wrong:

- The resolved service endpoint may be different from the container's exposed
  source port once tunneled from host.

Fix:

- Use `await svc.endpoint({ scheme: "http" })` then `dag.http(endpoint)`.

### INCORRECT: Expect `localhost` to always be routable from Dagger engine network

Why wrong:

- In DinD/devcontainer topologies, `localhost` can refer to the wrong network namespace.

Fix:

- Resolve a routable host address for service args in container environments
  (current logic prefers a non-internal IPv4 interface, eg `172.17.0.4`).
- Allow override with `SCORE_IDE_SERVICE_HOST`.

### INCORRECT: Kill only the `dagger call` client process on stop

Example failure:

- `stopService` sent `SIGTERM` to `state.process.pid` (the `dagger call` CLI).
- The CLI exited, but Dagger's internal port-forwarder child processes were in the
  same process group and survived, keeping the host TCP port bound.
- Next `dagger call <fn> up` failed immediately: `listen tcp 0.0.0.0:<port>: bind: address already in use`.
- Service state flipped stopped → starting → stopped without the port ever being free.
- `--<daggerArg>` was absent from subsequent pipeline calls because state was "stopped".

Why wrong:

- `cp.spawn(...)` without `detached: true` shares the parent's PGID. SIGTERM to a
  single PID does not reach child processes. Dagger spawns at least one port-forwarder
  child; that process keeps the host tunnel open.

Fix (already implemented in `servicesProvider.ts`):

- Spawn with `detached: true` so `dagger call up` gets its own process group
  (PGID == its own PID).
- Stop with `process.kill(-proc.pid, "SIGTERM")` (negative PID = whole process
  group). Every process Dagger spawned exits together, releasing the tunnel before
  state transitions to "stopped".
- Pair with `proc.unref()` so the VS Code host process is not kept alive by the
  detached child.

Rule for all future services:

- **Always spawn service processes with `{ detached: true }`.**
- **Always stop via `process.kill(-proc.pid, signal)`, with fallback to
  `proc.kill(signal)` if `pid` is undefined.**

### INCORRECT: Use `withExec` to run long-lived service process

Why wrong:

- `withExec` is build step; service process should be launched by `asService` args.

Fix:

- Use `.asService({ args: [...], useEntrypoint?: true })`.

## Verified working patterns

### Pattern A: Host service passed into pipeline function

Pipeline function signature:

```ts
@func()
async testOtel(otel: Service): Promise<string> {
  const endpoint = await otel.endpoint({ scheme: "http" });
  await dag.http(endpoint).contents();
  return "otel service reachable";
}
```

### Pattern B: Function-specific service flag injection in extension

- Start from running services with `daggerArg` configured.
- For selected function `fnName`, compute accepted flags from
  `dagger call fnName --help`.
- Inject only matching `--<daggerArg> tcp://<host>:<port>` pairs.

### Pattern C: Mocha smoke tests (no browser dependency)

- Start services with explicit test port mappings:
  - OTel: `14318:4318`
  - OCR: `18080:8080`
- Pass those mapped ports into pipeline service args.
- If ports are already up, reuse them instead of failing on bind conflicts.

## Minimal troubleshooting checklist

1. If you see `unknown flag: --...`
   - Extension is injecting unsupported flags for that function.
   - Verify function-specific filtering is active.

2. If you see timeout or connect errors in pipeline
   - Confirm service tunnel is healthy from host first:
     - `curl http://localhost:<frontend-port>`
   - Confirm pipeline function uses `svc.endpoint(...)`, not hardcoded alias port.

3. If service startup fails with `address already in use`
   - Root cause A: the previous `dagger call up` process group was not fully killed.
     Dagger's port-forwarder child processes survived and kept the host port bound.
     Fix already in code: `stopService` sends `SIGTERM` to the whole process group
     (`process.kill(-pid, "SIGTERM")`), and services are spawned with `detached: true`.
   - Root cause B: VS Code was restarted / extension reloaded while a service was
     running. The old `dagger call up` process is now orphaned — the extension has no
     PID handle, so `stopService` was never called. The port stays bound indefinitely.
     Fix already in code: `startService` runs `fuser -k <port>/tcp` (synchronously,
     silently) before spawning the new process, evicting any stale holder regardless
     of how it got there.

4. If service arg address is wrong in DinD
   - Check resolved host value.
   - Override with `SCORE_IDE_SERVICE_HOST=<ip>` if needed.

## How to add a new service + pipeline safely

1. Define service in `src/services.ts` with:
   - `id`, `daggerFn`, `ports`
   - `daggerArg` if pipelines should consume it as `Service`

2. Implement service function in `pipelines/src/index.ts` using `asService(...)`.

3. Implement pipeline function taking `Service` arg and use:
   - `endpoint = await svc.endpoint({ scheme: "http" })`
   - `await dag.http(endpoint).contents()` or equivalent client call

4. Start service via extension and run pipeline from extension.

5. Add or update mocha smoke test to cover the path.

## Current truth (as of this update)

- Extension-side service arg filtering per function is required and implemented.
- Endpoint-based pipeline smoke checks are the reliable way to validate host service args.
- Mocha smoke tests for `test-otel` and `test-ocr` pass without browser/puppeteer.
- Service processes are spawned with `{ detached: true }` and stopped with
  `process.kill(-proc.pid, "SIGTERM")` (process group kill) so Dagger's
  port-forwarder children are terminated and the host TCP tunnel is released on stop.
- `startService` runs `fuser -k <port>/tcp` before spawning to evict stale holders
  left over from crashed or reloaded VS Code sessions.
