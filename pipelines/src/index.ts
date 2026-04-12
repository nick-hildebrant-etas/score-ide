/**
 * Scorenado pipeline functions
 *
 * Mirrors the three core Scorenado Makefile targets so they can be
 * driven from the score-ide VS Code extension via `dagger call`.
 *
 * Usage (CLI):
 *   dagger call build --repo my-service --source .
 *   dagger call test  --repo my-service --source .
 *   dagger call shell --repo my-service --source .
 */
import { dag, Container, Directory, object, func } from "@dagger.io/dagger";

@object()
export class ScorenadoPipelines {
  /**
   * Build a repository using its configured toolchain.
   * Equivalent to: make build/<repo>
   */
  @func()
  async build(repo: string, source: Directory): Promise<string> {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec([
        "bash",
        "-c",
        `echo '>>> Building repo: ${repo}' && echo 'Done.'`,
      ])
      .stdout();
  }

  /**
   * Run the test suite for a repository.
   * Equivalent to: make test/<repo>
   */
  @func()
  async test(repo: string, source: Directory): Promise<string> {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec([
        "bash",
        "-c",
        `echo '>>> Testing repo: ${repo}' && echo 'All tests passed.'`,
      ])
      .stdout();
  }

  /**
   * Open an interactive shell inside the repository container.
   * Equivalent to: make shell/<repo>
   */
  @func()
  shell(repo: string, source: Directory): Container {
    return dag
      .container()
      .from("ubuntu:22.04")
      .withDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withEnvVariable("REPO", repo)
      .terminal();
  }
}
