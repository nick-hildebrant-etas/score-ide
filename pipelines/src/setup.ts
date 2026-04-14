/**
 * Setup pipeline — multi-repo checkout and workspace assembly.
 *
 * Assembles a Directory with layout:
 *   /<repoName>/   — one sub-directory per requested repo
 *
 * The returned Directory is passed as --source to build, test, and shell
 * pipelines. Run setup once at the start of a session; iterate build/test
 * against the result without re-cloning.
 *
 * Branch handling:
 *   - If the requested branch exists on the remote, it is checked out.
 *   - If it does not exist and createBranch is true and the repo's
 *     allowBranchCreation permits it, the branch is created from
 *     defaultBranch via a git container operation.
 *   - If it does not exist and createBranch is false (default), the
 *     pipeline fails with a clear error message.
 *
 * Usage (CLI):
 *   dagger call setup --branch main
 *   dagger call setup --branch feature/my-work --create-branch
 *   dagger call setup --branch feature/my-work --repos score-base
 */
import { dag, Directory } from "@dagger.io/dagger";
import { REPOS, RepoConfig } from "./repos.js";

export interface SetupOpts {
  /** Branch to check out in every requested repo. */
  branch: string;
  /**
   * Comma-separated list of repo names to include.
   * Omit or pass empty string to include all repos in REPOS.
   */
  repos?: string;
  /**
   * Create the branch from defaultBranch if it does not exist on the remote.
   * Respects the per-repo allowBranchCreation flag (default true).
   * @default false
   */
  createBranch?: boolean;
}

export async function setupWorkspace(opts: SetupOpts): Promise<Directory> {
  const { branch, createBranch = false } = opts;

  // Resolve the repo list
  const requested = opts.repos
    ? opts.repos.split(",").map((s) => s.trim()).filter(Boolean)
    : REPOS.map((r) => r.name);

  const configs: RepoConfig[] = requested.map((name) => {
    const cfg = REPOS.find((r) => r.name === name);
    if (!cfg) {
      const known = REPOS.map((r) => r.name).join(", ");
      throw new Error(`Unknown repo "${name}". Known repos: ${known}`);
    }
    return cfg;
  });

  // Assemble workspace: start with an empty directory and layer each repo in
  let workspace = dag.directory();

  for (const repo of configs) {
    const repoDir = await checkoutRepo(repo, branch, createBranch);
    workspace = workspace.withDirectory(repo.name, repoDir);
  }

  return workspace;
}

async function checkoutRepo(
  repo: RepoConfig,
  branch: string,
  createBranch: boolean,
): Promise<Directory> {
  // Fast path: try to fetch the requested branch directly via dag.git().
  // dag.git() is read-only; it fetches from the remote without cloning.
  try {
    return dag.git(repo.remote).branch(branch).tree();
  } catch {
    // Branch not found on remote — fall through to creation logic.
  }

  if (!createBranch) {
    throw new Error(
      `Branch "${branch}" not found in repo "${repo.name}" (${repo.remote}). ` +
      `Pass --create-branch to create it from "${repo.defaultBranch}".`,
    );
  }

  if (repo.allowBranchCreation === false) {
    throw new Error(
      `Branch creation is disabled for repo "${repo.name}". ` +
      `Create the branch manually or update allowBranchCreation in repos.ts.`,
    );
  }

  // Create the branch from defaultBranch via a git container.
  // We mount the default branch checkout, create the new branch, and return
  // the working tree. The branch is local-only inside the Dagger container —
  // pushing to the remote is out of scope for the setup pipeline.
  const base = dag.git(repo.remote).branch(repo.defaultBranch).tree();
  return dag
    .container()
    .from("alpine/git:latest")
    .withDirectory("/repo", base)
    .withWorkdir("/repo")
    .withExec(["git", "checkout", "-b", branch])
    .directory("/repo");
}
