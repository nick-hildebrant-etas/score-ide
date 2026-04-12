# OCI Registry Plan

## Goal

Bring up a local OCI registry service based on `registry:2`, expose it through the existing Services panel flow, and make its host/port available to pipeline jobs so the `test` pipeline can pull a mirrored image from the self-hosted registry.

Use `otel-webui` as the reference model. The registry should follow the same pattern: a standalone Dagger service managed from the Services panel, exposed on a host port, with its endpoint passed into the `dagger call` process environment. It should not be described or implemented as per-job sidecar wiring inside the pipeline container.

## Important naming note

The existing `ocr` service id is reserved for the OCR sidecar (port 8080, `src/services.ts`). It is still in active use. The new registry service **must** use id `oci-registry` (daggerFn `oci-registry`, label `OCI Registry`). Do not use `ocr`, `container-registry`, or any variant that could be confused with the OCR sidecar.

## Phase 0: prove the network path first

Before wiring the full feature, confirm the core assumption:

1. Start a `registry:2` service through Dagger.
2. Mirror or seed one known test image into that registry.
3. Run a minimal Dagger pipeline call that pulls `host:port/image:tag` from the registry-backed address.
4. Verify the Dagger engine can actually resolve and pull from that host/port path.

This is the first thing to prove because the registry only helps if the engine or pipeline path can really reach the service on the exposed port. If `localhost:<port>` is not reachable from the relevant pull path, the design has to change early.

`otel-webui` is the concrete example here: it already works as an external service on a host port, with the extension injecting its endpoint into the Dagger process environment rather than binding a collector sidecar into each job container.

## Phase 1: add the service to the extension and Dagger module

1. Add a new service entry in `src/services.ts`.
   - Use id/label/function name for the registry, not `ocr`.
   - Use port `5000` unless there is a reason to standardize on another port.
   - Add env vars that the extension can inject into pipeline terminals, for example `OCI_REGISTRY=localhost:5000`.

2. Add the Dagger service function in `pipelines/src/index.ts`.
   - Base it on `registry:2`.
   - Expose port `5000`.
   - If restart persistence matters, mount `/var/lib/registry` on a cache volume.
   - Keep the first version simple: plain registry behavior is enough if the image is pre-mirrored.

3. Reuse the existing `otel-webui` mechanics.
   - `otel-webui` is the working example: service entry in `src/services.ts`, Dagger service function in `pipelines/src/index.ts`, host port exposure, and endpoint injection from the extension.
   - The Services panel start/stop button already comes from `SERVICES`, so adding the new service definition should make it appear automatically.
   - Implement the registry the same way: standalone service with an exposed host port and an engine-level endpoint contract, not per-job sidecar wiring.

## Phase 2: make the `test` pipeline consume the mirrored image

1. Replace the current placeholder `test()` implementation with a real container path.
2. Make the image reference registry-qualified, using the injected registry host/port contract.
3. Keep the immediate scope narrow: only the image needed by `test` has to come from the self-hosted registry for now.
4. Do not attempt the full no-internet lockdown yet; just make the registry-backed pull path work reliably.

If the test pipeline still uses public upstream image references, the registry service is just decorative. The change is not complete until `test()` actually pulls from the mirrored registry path.

## Phase 3: test coverage and validation

There are now two test harnesses; both are real and should be used for different concerns:

- **Unit suite** (`npm test` → Mocha, `out/test/unit/**/*.test.js`): pure logic with no VS Code dependency. Use it for `parseDaggerFunctions`-style parser tests and SERVICES-constant assertions.
- **Extension-host suite** (`npm run test:suite` → `vscode-test`, `out/test/suite/**/*.test.js`): runs inside the VS Code process. Use it for anything that imports `vscode` directly or exercises tree-item / provider behaviour.

### What to write for the OCI registry work

1. **Unit test** — add to `src/test/unit/otelWebui.test.ts` or a new `src/test/unit/ociRegistry.test.ts`:
   - `SERVICES` contains an entry with `id === 'oci-registry'`.
   - `daggerFn === 'oci-registry'`.
   - `ports` includes `5000`.
   - `envVars` includes `OCI_REGISTRY` pointing to `localhost:5000`.
   - No field on the entry equals `'ocr'` (guard against id collision with the OCR sidecar).

2. **Extension-host test** — add to `src/test/suite/extension.test.ts` (the file already exists):
   - Extend the `ServicesProvider — initial state` suite or add a focused suite.
   - After `startService` resolves its `spawn` event, `bindEnv()` must include `OCI_REGISTRY`.
   - `getChildren()` must include an item with `label === 'OCI Registry'` in stopped state.
   - Keep the test self-contained: pass a stub `resolvePipelinesDir` and do not actually spawn Dagger.

3. **Root TypeScript validation** — already wired: `pretest` now runs `tsc -p pipelines/tsconfig.json --noEmit`, so the Dagger module is type-checked on every `npm test` run.

4. **Integration smoke test** (optional, live Docker):
   - Mirror the pattern from `otelWebui.test.ts`: skip if Docker is unavailable, start the registry container, push a known image, assert the registry API responds on port 5000, tear down.
   - Place in the unit suite (plain Mocha) since it does not need the extension host.

5. The normal `npm test` path already catches SERVICES changes; `npm run test:suite` catches provider behaviour. Both should stay green before merging the OCI registry phase.

## Phase 4: later lockdown work

Once the registry-backed `test` flow is proven, then move to the stricter network model:

1. Limit pipeline containers to the OCI registry, pip mirror, and bazel remote cache endpoints.
2. Remove general internet access from build/test jobs.
3. Add failure-mode coverage so it is obvious when a job still depends on public network access.

## Acceptance criteria for this next phase

1. A new registry service appears in the Services panel and can be started/stopped.
2. Starting it exposes a documented host port for local use.
3. The registry endpoint is automatically available to pipeline runs from the extension.
4. The `test` pipeline can pull the mirrored image through the self-hosted registry path.
5. The normal repo validation path checks both the extension TypeScript and the `pipelines/` TypeScript.
