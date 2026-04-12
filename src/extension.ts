import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface PipelineFn {
  name: string;
  description: string;
}

class PipelineItem extends vscode.TreeItem {
  constructor(public readonly fn: PipelineFn) {
    super(fn.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'pipeline';
    this.description = fn.description;
    this.tooltip = fn.description || `dagger call ${fn.name}`;
  }
}

class DaggerPipelinesProvider implements vscode.TreeDataProvider<PipelineItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PipelineItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<PipelineItem[]> {
    const pipelinesDir = this.resolvePipelinesDir();
    if (!pipelinesDir) {
      return [this.placeholder('No workspace open')];
    }

    if (!fs.existsSync(path.join(pipelinesDir, 'dagger.json'))) {
      return [this.placeholder('No dagger.json found — configure score-ide.pipelinesDir')];
    }

    try {
      const fns = await this.daggerFunctions(pipelinesDir);
      return fns.length > 0
        ? fns.map(f => new PipelineItem(f))
        : [this.placeholder('No functions found in dagger module')];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return [this.placeholder(`dagger functions failed: ${msg}`)];
    }
  }

  resolvePipelinesDir(): string | undefined {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return undefined;
    }
    const sub: string = vscode.workspace
      .getConfiguration('score-ide')
      .get('pipelinesDir', '');
    return sub ? path.join(workspaceRoot, sub) : workspaceRoot;
  }

  private daggerFunctions(cwd: string): Promise<PipelineFn[]> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, DAGGER_NO_NAG: '1' };
      cp.exec('dagger functions', { cwd, env }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(parseDaggerFunctions(stdout));
      });
    });
  }

  private placeholder(label: string): PipelineItem {
    const item = new PipelineItem({ name: label, description: '' });
    item.contextValue = '';
    return item;
  }
}

/**
 * Parse the plain-text table emitted by `dagger functions`.
 *
 * Expected format (dagger v0.12+):
 *   Name    Description
 *   ─────   ──────────────────
 *   build   Build a repository …
 *   test    Run tests …
 */
function parseDaggerFunctions(output: string): PipelineFn[] {
  const results: PipelineFn[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    // Skip header row and Unicode/ASCII separator lines
    if (/^Name\b/i.test(trimmed) || /^[─\-━=]+/.test(trimmed)) {
      continue;
    }
    // Split on 2+ spaces (name and description columns)
    const [name, ...rest] = trimmed.split(/\s{2,}/);
    if (name) {
      results.push({ name: name.trim(), description: rest.join('  ').trim() });
    }
  }

  return results;
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new DaggerPipelinesProvider();

  const treeView = vscode.window.createTreeView('score-ide.pipelinesView', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const runCmd = vscode.commands.registerCommand(
    'score-ide.runPipeline',
    async (item: PipelineItem) => {
      const repo = await vscode.window.showInputBox({
        prompt: `Repo ID for "${item.fn.name}"`,
        placeHolder: 'e.g. my-service',
      });
      if (repo === undefined) {
        return; // cancelled
      }

      const repoArg = repo ? `--repo ${repo} ` : '';
      const pipelinesDir = provider.resolvePipelinesDir();
      const terminal = vscode.window.createTerminal({
        name: `dagger: ${item.fn.name}`,
        cwd: pipelinesDir,
        env: { DAGGER_NO_NAG: '1' },
      });
      terminal.show();
      terminal.sendText(`dagger call ${item.fn.name} ${repoArg}--source .`);
    }
  );

  const refreshCmd = vscode.commands.registerCommand('score-ide.refreshPipelines', () => {
    provider.refresh();
  });

  // Re-list when the setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('score-ide.pipelinesDir')) {
        provider.refresh();
      }
    })
  );

  context.subscriptions.push(treeView, runCmd, refreshCmd);
}

export function deactivate() {}
