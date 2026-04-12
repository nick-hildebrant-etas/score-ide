import * as vscode from "vscode";
import * as cp from "child_process";
import { ServiceDef, SERVICES } from "./services";

type ServiceStatus = "stopped" | "starting" | "running" | "stopping";

interface ServiceState {
  status: ServiceStatus;
  process?: cp.ChildProcess;
  port?: number;
}

class ServiceItem extends vscode.TreeItem {
  constructor(
    public readonly def: ServiceDef,
    private readonly state: ServiceState,
  ) {
    super(def.label, vscode.TreeItemCollapsibleState.None);

    switch (state.status) {
      case "stopped":
        this.iconPath = new vscode.ThemeIcon("debug-start");
        this.description = "Stopped";
        this.contextValue = "service-stopped";
        break;
      case "starting":
        this.iconPath = new vscode.ThemeIcon("loading~spin");
        this.description = "Starting\u2026";
        this.contextValue = "service-starting";
        break;
      case "running":
        this.iconPath = new vscode.ThemeIcon("circle-filled");
        this.description = `localhost:${state.port ?? def.ports[0]}`;
        this.contextValue = "service-running";
        break;
      case "stopping":
        this.iconPath = new vscode.ThemeIcon("loading~spin");
        this.description = "Stopping\u2026";
        this.contextValue = "service-stopping";
        break;
    }
  }
}

export class ServicesProvider implements vscode.TreeDataProvider<ServiceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private states = new Map<string, ServiceState>(
    SERVICES.map((s) => [s.id, { status: "stopped" }]),
  );

  /** One output channel per service, created lazily and reused across restarts. */
  private channels = new Map<string, vscode.OutputChannel>();

  constructor(private readonly resolvePipelinesDir: () => string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ServiceItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ServiceItem[] {
    return SERVICES.map(
      (def) => new ServiceItem(def, this.states.get(def.id)!),
    );
  }

  /**
   * Returns merged env vars from all currently running services that declare
   * envVars. These are injected into the terminal running `dagger call` so that
   * Dagger's engine-level OTel tracing flows to the collector automatically —
   * no pipeline-function argument changes required.
   */
  bindEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const def of SERVICES) {
      const state = this.states.get(def.id);
      if (state?.status === "running" && def.envVars) {
        Object.assign(env, def.envVars);
      }
    }
    return env;
  }

  startService(def: ServiceDef): void {
    const state = this.states.get(def.id);
    if (state?.status !== "stopped") {
      return;
    }

    this.setState(def.id, { status: "starting" });

    const channel = this.getChannel(def);
    channel.clear();
    channel.show(true /* preserveFocus */);

    const pipelinesDir = this.resolvePipelinesDir();
    const proc = cp.spawn("dagger", ["call", def.daggerFn, "up"], {
      cwd: pipelinesDir,
      env: { ...process.env, DAGGER_NO_NAG: "1" },
    });

    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    proc.stdout.on("data", (chunk: Buffer) =>
      channel.append(stripAnsi(chunk.toString())),
    );
    proc.stderr.on("data", (chunk: Buffer) =>
      channel.append(stripAnsi(chunk.toString())),
    );

    proc.on("spawn", () => {
      this.setState(def.id, {
        status: "running",
        process: proc,
        port: def.ports[0],
      });
    });

    proc.on("close", (code) => {
      channel.appendLine(`\n[exited with code ${code ?? "?"}]`);
      this.setState(def.id, { status: "stopped" });
    });

    proc.on("error", (err) => {
      channel.appendLine(`\n[error: ${err.message}]`);
      this.setState(def.id, { status: "stopped" });
    });
  }

  stopService(def: ServiceDef): void {
    const state = this.states.get(def.id);
    if (state?.status !== "running" || !state.process) {
      return;
    }

    this.setState(def.id, {
      status: "stopping",
      process: state.process,
      port: state.port,
    });
    // SIGTERM lets Dagger clean up the service container; 'close' handler above
    // will transition state to 'stopped'.
    state.process.kill("SIGTERM");
  }

  private getChannel(def: ServiceDef): vscode.OutputChannel {
    let ch = this.channels.get(def.id);
    if (!ch) {
      ch = vscode.window.createOutputChannel(`Score IDE: ${def.label}`);
      this.channels.set(def.id, ch);
    }
    return ch;
  }

  private setState(id: string, state: ServiceState): void {
    this.states.set(id, state);
    this._onDidChangeTreeData.fire();
  }
}
