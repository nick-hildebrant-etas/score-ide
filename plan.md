# PyPI Mirror Plan

## Current status

- OCI Registry service removed (no longer needed).
- PyPI mirror service (`pip-mirror`, port 3141) is implemented and wired.
- `test-pypi` smoke pipeline function added, modeled after `test-ocr`.
- Mocha smoke test added to `pipelineBindings.test.ts` (port 13141 for test tunnel).

## Active services

| id                  | port | daggerArg         | status   |
|---------------------|------|-------------------|----------|
| `otel-webui`        | 4318 | `otel`            | working  |
| `ocr`               | 8080 | `ocr`             | working  |
| `pip-mirror`        | 3141 | `pip-mirror`      | stub → replace with uv+pypiserver |
| `bazel-remote-cache`| 9090 | `bazel-remote-cache` | stub  |

## Smoke test functions

| Dagger function | Service arg   | Checks                                      | status   |
|-----------------|---------------|---------------------------------------------|----------|
| `test-otel`     | `--otel`      | OTel endpoint reachable via dag.http()      | passing  |
| `test-ocr`      | `--ocr`       | Registry `/v2/` returns `{}`               | passing  |
| `test-pypi`     | `--pip-mirror`| Mirror `/simple/` returns `Simple index`    | added    |

## PyPI mirror — implementation plan

Replace the current `python:3.12-alpine` + hand-rolled HTTP server stub with a real `pypiserver` instance served via `uv`.

### Target implementation (`pipelines/src/index.ts` — `pipMirror()`)

- **Base image**: `ghcr.io/astral-sh/uv:alpine` (latest)
- **Server**: `pypiserver` installed and run via `uv`:
  ```
  uv run --with pypiserver pypi-server run -p 3141 /data/packages
  ```
- `/data/packages` can start empty — pypiserver will serve an empty but valid PEP 503 index.
- Exposed port: `3141` (unchanged).

### `uv` environment variables for consumers

When a pipeline function uses the mirror, set:

| Variable | Value |
|---|---|
| `UV_INDEX_URL` | `http://<mirror-endpoint>/simple/` |
| `UV_INSECURE_HOST` | `<mirror-host>:<port>` (allow HTTP, no TLS) |
| `UV_EXTRA_INDEX_URL` | `https://pypi.org/simple/` (fallback) |

### Smoke test (`test-pypi`)

Current assertion (`Simple index` in body) remains valid — pypiserver returns proper PEP 503 HTML.
Future: extend to `uv pip install <pkg> --index-url <endpoint>/simple/` against a seeded package.

### Steps

1. Update `pipMirror()` in `pipelines/src/index.ts`:
   - Change base image to `ghcr.io/astral-sh/uv:alpine`.
   - Replace `asService({ args: ["python3", "/server.py"] })` with `asService({ args: ["uv", "run", "--with", "pypiserver", "pypi-server", "run", "-p", "3141", "/data/packages"] })`.
   - Remove the inline Python script and `withNewFile`.
2. Verify `dagger call pip-mirror up` starts cleanly and `/simple/` returns PEP 503 HTML.
3. Verify `dagger call test-pypi --pip-mirror tcp://localhost:3141` passes.

## How to add a new service + test (checklist)

Follow the pattern proven by OCR and PyPI mirror:

1. Add entry to `src/services.ts` with `id`, `daggerFn`, `ports`, `daggerArg`.
2. Implement service function in `pipelines/src/index.ts` using `.asService({ args: [...] })`.
3. Implement `test<Name>(svc: Service)` pipeline function:
   - `endpoint = await svc.endpoint({ scheme: "http" })`
   - `dag.http(endpoint).contents()` and assert expected response
4. Add to `pipelineBindings.test.ts`:
   - `const TEST_<NAME>_PORT = <unique test port>`
   - `ensureService(...)` in `suiteSetup`
   - `stopService(...)` in `suiteTeardown`
   - `runPipeline("test-<name>", "<daggerArg>", ...)` test
