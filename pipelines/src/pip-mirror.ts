/**
 * PyPI mirror — local airgapped dependency mirror for Python packages.
 *
 * Uses pypiserver + gunicorn installed via pip on python:alpine. Baking
 * the packages into the image layer means the service starts immediately
 * with no runtime package downloads. Consumers route installs through
 * this mirror by setting:
 *   UV_INDEX_URL=http://<endpoint>/simple/
 *   UV_INSECURE_HOST=<host>:<port>
 *
 * When this service is running, ci.ts injects the equivalent Bazel
 * repo_env flags so that rules_python resolves packages through the
 * mirror instead of PyPI directly.
 */
import { dag, Service } from "@dagger.io/dagger";

export function pipMirrorService(): Service {
  return dag
    .container()
    .from("python:3-alpine")
    .withExec(["pip", "install", "--no-cache-dir", "pypiserver[passlib]", "gunicorn"])
    .withExec(["mkdir", "-p", "/data/packages"])
    .withExposedPort(3141)
    .asService({
      args: [
        "pypi-server", "run",
        "--server", "gunicorn",
        "-p", "3141",
        "-a", ".", "-P", ".",
        "/data/packages",
      ],
    });
}

export async function smokeTestPypi(pipMirror: Service): Promise<string> {
  const endpoint = await pipMirror.endpoint({ scheme: "http" });

  const index = await dag
    .container()
    .from("python:3-alpine")
    .withServiceBinding("pip-mirror", pipMirror)
    .withExec(["wget", "-qO-", `${endpoint}/simple/`])
    .stdout();

  if (!index.toLowerCase().includes("simple index")) {
    throw new Error(`pip-mirror /simple/ did not return PEP 503 index: ${index}`);
  }
  return "pip-mirror: /simple/ returns PEP 503 Simple index";
}
