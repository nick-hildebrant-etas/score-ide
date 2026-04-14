/**
 * Setup pipeline tests.
 *
 * Static suite: verifies the REPOS registry is well-formed and getRepo()
 * throws on unknown names — no network or Dagger required.
 *
 * Live suite (Dagger required): exercises the setup pipeline against a
 * public read-only repository to verify branch checkout works end-to-end.
 * Skipped when the `dagger` CLI is not available.
 */

import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';

// Import repos from compiled output (pipelines/ is excluded from the root tsconfig
// so we read the raw compiled JS after `npm run pretest` runs `tsc` on pipelines/).
// If the pipelines tsconfig hasn't been compiled yet these tests will be skipped.
let REPOS: Array<{ name: string; remote: string; defaultBranch: string }> | undefined;
let getRepo: ((name: string) => { name: string }) | undefined;

try {
  const mod = require(path.resolve(__dirname, '../../../pipelines/out/repos.js'));
  REPOS = mod.REPOS;
  getRepo = mod.getRepo;
} catch {
  // pipelines not compiled yet — static tests that depend on it will skip
}

function daggerAvailable(): boolean {
  const r = cp.spawnSync('dagger', ['version'], { stdio: 'ignore' });
  return r.status === 0;
}

// ── Static checks ─────────────────────────────────────────────────────────────

suite('Setup pipeline — repo registry', function () {
  test('REPOS is defined and non-empty', function () {
    if (!REPOS) { this.skip(); }
    assert.ok(Array.isArray(REPOS) && REPOS!.length > 0, 'REPOS should have at least one entry');
  });

  test('every repo has name, remote, and defaultBranch', function () {
    if (!REPOS) { this.skip(); }
    for (const repo of REPOS!) {
      assert.ok(repo.name, `repo missing name: ${JSON.stringify(repo)}`);
      assert.ok(repo.remote, `repo "${repo.name}" missing remote`);
      assert.ok(repo.remote.startsWith('https://') || repo.remote.startsWith('git@'),
        `repo "${repo.name}" remote should be https or ssh URL`);
      assert.ok(repo.remote, `repo "${repo.name}" missing defaultBranch`);
    }
  });

  test('repo names are unique', function () {
    if (!REPOS) { this.skip(); }
    const names = REPOS!.map(r => r.name);
    const unique = new Set(names);
    assert.strictEqual(unique.size, names.length, 'REPOS contains duplicate names');
  });

  test('getRepo throws on unknown name', function () {
    if (!getRepo) { this.skip(); }
    assert.throws(
      () => getRepo!('no-such-repo'),
      /Unknown repo/,
    );
  });

  test('getRepo returns correct config for known repo', function () {
    if (!REPOS || !getRepo) { this.skip(); }
    const first = REPOS![0];
    const result = getRepo!(first.name);
    assert.strictEqual(result.name, first.name);
  });
});

// ── Live Dagger checks ─────────────────────────────────────────────────────────

suite('Setup pipeline — live dagger', function () {
  this.timeout(120_000);

  suiteSetup(function () {
    if (!daggerAvailable()) { this.skip(); }
  });

  test('setup checks out main branch of first repo', function (done) {
    if (!REPOS || !daggerAvailable()) { this.skip(); }
    const repoName = REPOS![0].name;
    const proc = cp.spawn(
      'dagger', ['call', '--progress', 'plain', 'setup', '--branch', 'main', '--repos', repoName],
      { cwd: path.resolve(__dirname, '../../../pipelines'), stdio: 'pipe' },
    );
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        done();
      } else {
        done(new Error(`dagger call setup exited ${code}: ${stderr.slice(-500)}`));
      }
    });
  });
});
