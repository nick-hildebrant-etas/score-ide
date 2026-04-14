/**
 * Observability — OTel Web UI service and smoke test.
 *
 * The OTel service is the first thing started in a developer session.
 * Engine-level traces flow to it automatically when
 * OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 is set in the
 * calling environment (injected by the score-ide extension).
 *
 * TODO: In-container tracing (so build/test scripts inside containers
 * can also export traces) requires dag.host().service([PortForward(...)])
 * to tunnel the host collector port into the container. That API is
 * available in the Python dagger-io SDK but not yet in TypeScript
 * modules in Dagger v0.20.x. Once available, export a
 * bindOtelToContainer(ctr, otel) helper from here for ci.ts to use.
 */
import { dag, Service } from "@dagger.io/dagger";

export function otelWebuiService(): Service {
  return dag
    .container()
    .from("ghcr.io/metafab/otel-gui:latest")
    .withExposedPort(4318)
    .asService();
}

export async function smokeTestOtel(otel: Service): Promise<string> {
  const endpoint = await otel.endpoint({ scheme: "http" });
  await dag.http(endpoint).contents();
  return "otel service reachable";
}
