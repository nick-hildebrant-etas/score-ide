/**
 * PyPI mirror — local airgapped dependency mirror for Python packages.
 *
 * Uses pypiserver via uv on the official uv Alpine image. Consumers
 * route installs through this mirror by setting:
 *   UV_INDEX_URL=http://<endpoint>/simple/
 *   UV_INSECURE_HOST=<host>:<port>
 *
 * When this service is running, ci.ts injects the equivalent Bazel
 * repo_env flags so that rules_python resolves packages through the
 * mirror instead of PyPI directly.
 *
 * The smoke test verifies the full round-trip: download a package from
 * PyPI, upload it to the mirror via twine, then confirm it appears in
 * the mirror's /simple/ index.
 */
import { dag, Service } from "@dagger.io/dagger";

export function pipMirrorService(): Service {
  return dag
    .container()
    .from("ghcr.io/astral-sh/uv:alpine")
    .withExec(["mkdir", "-p", "/data/packages"])
    .withExposedPort(3141)
    .asService({
      args: [
        "uv", "run", "--with", "pypiserver", "--with", "gunicorn",
        "pypi-server", "run", "--server", "gunicorn", "-p", "3141", "-a", ".", "-P", ".", "/data/packages",
      ],
    });
}

export async function smokeTestPypi(pipMirror: Service): Promise<string> {
  const endpoint = await pipMirror.endpoint({ scheme: "http" });
  const port = endpoint.split(":").pop()!;
  const mirrorUrl = `http://pip-mirror:${port}`;

  const index = await dag
    .container()
    .from("ghcr.io/astral-sh/uv:alpine")
    .withServiceBinding("pip-mirror", pipMirror)
    .withEnvVariable("TWINE_USERNAME", "dummy")
    .withEnvVariable("TWINE_PASSWORD", "dummy")
    .withExec(["uv", "tool", "install", "twine"])
    .withExec(["uv", "run", "python", "-m", "pip", "download", "numpy", "--dest", "/packages"])
    .withExec([
      "sh", "-c",
      `uv tool run twine upload --repository-url ${mirrorUrl} /packages/*`,
    ])
    .withExec(["wget", "-qO-", `${mirrorUrl}/simple/`])
    .stdout();

  if (!index.includes("numpy")) {
    throw new Error(`numpy not found in mirror index after upload: ${index}`);
  }
  return "pip-mirror: numpy mirrored and verified";
}
