# Review

## Findings

1. High - The run command does not honor `score-ide.pipelinesDir`, so the sidebar can list pipelines that the inline run action cannot execute.

   `src/extension.ts:33-43` discovers functions by running `dagger functions` inside the configured pipelines directory, but `src/extension.ts:134-136` creates a terminal with the default cwd and sends `dagger call <fn> --repo <id> --source .` without changing directories or passing a module path. In a clean shell at the workspace root, `dagger functions` returned `No functions found.` and `dagger call build --repo demo --source .` failed with `unknown command "build" for "dagger call"`. In `pipelines/`, the same module exposes `build`, `shell`, and `test` correctly. This makes the documented run flow inaccurate in `README.md:8` and `CLAUDE.md:24` whenever the module lives below the workspace root, which is the repo's own recommended setup.

2. High - The documented `npm test` workflow is currently broken because ESLint 9 is configured without any ESLint config file.

   `package.json:73-75` wires `npm test` through `npm run lint`, and `package.json:85` installs ESLint 9.39.4, but the repo does not contain `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`, or a legacy `.eslintrc.*` file. Running `npm test` failed immediately with `ESLint couldn't find an eslint.config.(js|mjs|cjs) file.` As written, the development command sections in `README.md:68` and `CLAUDE.md:11` are not true for the current change set.

3. Medium - The repository advertises an extension test suite, but there is no test entrypoint or test sources behind that claim.

   `.vscode/launch.json:18-20` points the `Extension Tests` configuration at `${workspaceFolder}/out/test/suite/index`, but there are no files under `src/test/` and no compiled files under `out/test/`. Even after the lint failure is fixed, the repo still does not contain the VS Code test suite that `README.md:68` and `CLAUDE.md:11` imply exists.

4. Low - The devcontainer note in `CLAUDE.md` is out of date and assigns bootstrap responsibilities to the wrong component.

   `CLAUDE.md:50` says `post-create.sh` installs the Dagger CLI and Docker-in-Docker on container creation. In the actual setup, Docker-in-Docker comes from `.devcontainer/devcontainer.json:20`, while `.devcontainer/post-create.sh:4-20` installs Docker CLI if needed, installs Dagger CLI, runs `npm install`, and installs `@anthropic-ai/claude-code`. The current doc omits important setup steps and misstates how DinD is provided.

## Notes

- I did not modify any project files beyond adding this review.
- I validated the reported command behavior against the current workspace and its documented commands.
- The sample Dagger functions only echo output, so the `--source` argument does not expose a behavioral difference inside `pipelines/`; the confirmed issue is the terminal being launched from the wrong context relative to discovery.
