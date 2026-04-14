/**
 * Container registry — OCI registry service and smoke test.
 *
 * Provides a local Docker registry v2 for airgapped container image
 * push/pull. Consumers push images to tcp://<host>:5000 and pull from
 * the same endpoint.
 *
 * Note: the service ID and Dagger function name are currently "ocr"
 * (a historical abbreviation for OCI Container Registry). This is
 * ambiguous with Optical Character Recognition and will be renamed to
 * "registry" in a future coordinated PR. This file uses the correct
 * domain name in preparation for that rename.
 */
import { dag, Service } from "@dagger.io/dagger";

export function ociRegistryService(): Service {
  return dag
    .container()
    .from("registry:2")
    .withExposedPort(5000)
    .asService();
}

export async function smokeTestOcr(ocr: Service): Promise<string> {
  const endpoint = await ocr.endpoint({ scheme: "http" });
  await dag.http(`${endpoint}/v2/`).contents();
  return "ocr service reachable";
}
