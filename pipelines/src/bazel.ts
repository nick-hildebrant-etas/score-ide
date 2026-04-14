/**
 * Build cache and remote execution services.
 *
 * Current: a minimal HTTP stub that implements enough of the Bazel
 * Remote Execution API (CAS/AC endpoints) to satisfy health checks.
 *
 * Planned additions (in priority order):
 *   1. Replace stub with real buchgr/bazel-remote instance
 *   2. buildbarnScheduler() — BuildBarn scheduler (REAPI/gRPC)
 *   3. buildbarnWorker()    — BuildBarn worker (sandboxed execution)
 *   4. buildbarnBrowser()   — BuildBarn web UI
 *   5. smokeTestBazelCache() — verify CAS/AC endpoints
 *   6. smokeTestBazelRE()    — verify remote execution round-trip
 *
 * Split into bazel-cache.ts + buildbarn.ts when BuildBarn services land,
 * not before.
 */
import { dag, Service } from "@dagger.io/dagger";

export function bazelRemoteCacheService(): Service {
  const server = `\
import http.server

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/status":
            body = b'{"state":"ok"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/cas/") or self.path.startswith("/ac/"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
    def log_message(self, *a):
        pass

http.server.HTTPServer(("", 9090), H).serve_forever()
`;
  return dag
    .container()
    .from("python:3.12-alpine")
    .withNewFile("/server.py", server)
    .withExposedPort(9090)
    .asService({ args: ["python3", "/server.py"] });
}
