/**
 * Extension-host tests — run inside the VS Code process via `npm run test:suite`.
 *
 * Two suites:
 *   1. parseDaggerFunctions — pure parser logic; no VS Code API called, but the
 *      function lives in extension.ts which imports vscode, so an extension-host
 *      context is required to load the module without mocking.
 *   2. ServicesProvider — verifies tree-item construction and env-binding using
 *      the real vscode.TreeItem / vscode.ThemeIcon APIs.
 */

import * as assert from 'assert';
import { parseDaggerFunctions } from '../../extension';
import { ServicesProvider } from '../../servicesProvider';
import { SERVICES } from '../../services';

// ── parseDaggerFunctions ──────────────────────────────────────────────────────

suite('parseDaggerFunctions', () => {
  test('empty input returns empty array', () => {
    assert.deepStrictEqual(parseDaggerFunctions(''), []);
  });

  test('blank-only input returns empty array', () => {
    assert.deepStrictEqual(parseDaggerFunctions('   \n  \n'), []);
  });

  test('header and separator lines are skipped', () => {
    const input = [
      'Name    Description',
      '─────   ──────────────────',
      'build   Build a repository',
    ].join('\n');
    assert.deepStrictEqual(parseDaggerFunctions(input), [
      { name: 'build', description: 'Build a repository' },
    ]);
  });

  test('parses name-only entry (no description column)', () => {
    const input = 'Name\n─────\nbuild';
    assert.deepStrictEqual(parseDaggerFunctions(input), [
      { name: 'build', description: '' },
    ]);
  });

  test('parses multiple functions', () => {
    const input = [
      'Name    Description',
      '─────   ──────────────────',
      'build   Build a repository',
      'test    Run tests',
      'shell   Open a shell',
    ].join('\n');
    const result = parseDaggerFunctions(input);
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result[1], { name: 'test', description: 'Run tests' });
  });

  test('strips ANSI escape codes before parsing', () => {
    // Dagger sometimes emits bold function names
    const input = '\x1b[1mName\x1b[0m    Description\n\x1b[1mbuild\x1b[0m   Build';
    const result = parseDaggerFunctions(input);
    // Header line should be skipped; build should be parsed cleanly
    assert.ok(result.some(f => f.name === 'build' && f.description === 'Build'),
      `expected {name:'build', description:'Build'}, got: ${JSON.stringify(result)}`);
  });

  test('ASCII separator line (dashes) is skipped', () => {
    const input = 'Name    Description\n-----   ------\nbuild   Build';
    const result = parseDaggerFunctions(input);
    assert.deepStrictEqual(result, [{ name: 'build', description: 'Build' }]);
  });
});

// ── ServicesProvider ──────────────────────────────────────────────────────────

suite('ServicesProvider — initial state', () => {
  let provider: ServicesProvider;

  setup(() => {
    provider = new ServicesProvider(() => undefined);
  });

  test('getChildren returns one item per SERVICES entry', () => {
    const items = provider.getChildren();
    assert.strictEqual(items.length, SERVICES.length);
  });

  test('every item starts in stopped state (contextValue == service-stopped)', () => {
    const items = provider.getChildren();
    for (const item of items) {
      assert.strictEqual(
        item.contextValue,
        'service-stopped',
        `expected service-stopped for "${String(item.label)}"`,
      );
    }
  });

  test('every item description is "Stopped"', () => {
    const items = provider.getChildren();
    for (const item of items) {
      assert.strictEqual(
        item.description,
        'Stopped',
        `expected description "Stopped" for "${String(item.label)}"`,
      );
    }
  });

  test('tree item labels match service definitions in order', () => {
    const items = provider.getChildren();
    const labels = items.map(i => String(i.label));
    const expected = SERVICES.map(s => s.label);
    assert.deepStrictEqual(labels, expected);
  });

  test('bindEnv returns empty object when all services are stopped', () => {
    assert.deepStrictEqual(provider.bindEnv(), {});
  });
});
