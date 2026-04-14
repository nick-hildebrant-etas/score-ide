/**
 * Repo registry — the configurable list of repositories managed by score-ide.
 *
 * All repos are built with Bazel inside eclipse/score-devcontainer. The 80%
 * shared pipeline logic lives in ci.ts; this file holds the 20% that varies
 * per repo (targets, flags, hooks, image overrides).
 *
 * Adding a new repo: add an entry to REPOS. No other file needs to change
 * unless the repo requires non-default behaviour.
 *
 * No Dagger SDK imports here — this is pure data.
 */

/** Default devcontainer image used for all Bazel builds. */
export const DEFAULT_DEVCONTAINER = "ghcr.io/eclipse-score/devcontainer:latest";

export interface BazelConfig {
  /** Targets passed to `bazel build`. Defaults to ["//..."]. */
  buildTargets: string[];
  /** Targets passed to `bazel test`. Defaults to ["//..."]. */
  testTargets: string[];
  /** Extra flags appended to every `bazel build` invocation. */
  buildFlags?: string[];
  /** Extra flags appended to every `bazel test` invocation. */
  testFlags?: string[];
}

export interface RepoConfig {
  /**
   * Short identifier used as the --repo CLI argument and as the sub-directory
   * name in the assembled workspace (e.g. "score-base" → /workspace/score-base).
   */
  name: string;
  /** HTTPS or SSH remote URL. */
  remote: string;
  /** Branch checked out when no explicit branch is requested. */
  defaultBranch: string;
  bazel: BazelConfig;
  /**
   * Override the build container image. Defaults to DEFAULT_DEVCONTAINER.
   * Use this when a repo requires a specialised toolchain not present in
   * the shared devcontainer.
   */
  devcontainerImage?: string;
  /**
   * Shell snippet executed inside the container before `bazel build` runs.
   * Use sparingly — prefer Bazel workspace rules for setup where possible.
   */
  preBuildScript?: string;
  /** Extra environment variables injected into the build container. */
  extraEnv?: Record<string, string>;
  /**
   * Whether the setup pipeline may create this branch if it does not exist.
   * Set false for read-only mirrors or repos where branch creation must go
   * through an external review process.
   * @default true
   */
  allowBranchCreation?: boolean;
}

export const REPOS: RepoConfig[] = [
  // TODO: Replace with real Eclipse SCORE repo URLs once remote access is
  // confirmed in the devcontainer environment.
  {
    name: "score-base",
    remote: "https://github.com/eclipse-score/score",
    defaultBranch: "main",
    bazel: {
      buildTargets: ["//..."],
      testTargets: ["//..."],
      buildFlags: ["--config=ci"],
      testFlags: ["--config=ci"],
    },
  },
];

/**
 * Look up a repo by name. Throws if the name is not in REPOS, so callers
 * get an early, readable error rather than a downstream null-dereference.
 */
export function getRepo(name: string): RepoConfig {
  const config = REPOS.find((r) => r.name === name);
  if (!config) {
    const known = REPOS.map((r) => r.name).join(", ");
    throw new Error(`Unknown repo "${name}". Known repos: ${known}`);
  }
  return config;
}
