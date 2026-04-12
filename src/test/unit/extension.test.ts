import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
);

const commandIds: string[] = pkg.contributes.commands.map((c: { command: string }) => c.command);

suite('Extension — package.json contributions', () => {
  test('score-ide.runPipeline is declared', () => {
    assert.ok(commandIds.includes('score-ide.runPipeline'));
  });

  test('score-ide.refreshPipelines is declared', () => {
    assert.ok(commandIds.includes('score-ide.refreshPipelines'));
  });

  test('score-ide.startService is declared', () => {
    assert.ok(commandIds.includes('score-ide.startService'));
  });

  test('score-ide.stopService is declared', () => {
    assert.ok(commandIds.includes('score-ide.stopService'));
  });

  test('score-ide.refreshServices is declared', () => {
    assert.ok(commandIds.includes('score-ide.refreshServices'));
  });
});
