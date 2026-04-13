import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import { ServiceDef, SERVICES } from "./services";

type ServiceStatus = "stopped" | "starting" | "running" | "stopping";

interface ServiceState {
  status: ServiceStatus;
  process?: cp.ChildProcess;
  port?: number;
}

function resolveServiceHost(): string {
  const override = process.env.SCORE_IDE_SERVICE_HOST?.trim();
  if (override) {
    return override;
  }

  // In local (non-container) setups, localhost is the expected host service address.
  if (!fs.existsSync("/.dockerenv")) {
    return "localhost";
  }

  const net = os.networkInterfaces();
  const isIPv4 = (family: string | number): boolean =>
    family === "IPv4" || family === 4;

  for (const iface of ["eth0", "en0"]) {
    const entries = net[iface] ?? [];
    for (const e of entries) {
      if (isIPv4(e.family) && !e.internal) {
        return e.address;
      }
    }
  }

  for (const entries of Object.values(net)) {
    for (const e of entries ?? []) {
      if (isIPv4(e.family) && !e.internal) {
        return e.address;
      }
    }
  }

  return "localhost";
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

  private readonly serviceHost = resolveServiceHost();
  private readonly acceptedFlagsCache = new Map<string, Set<string>>();

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

  /**
   * Returns CLI flag pairs for every running service that declares a
   * `daggerArg`.  These are appended to `dagger call` commands so that
   * pipeline functions receive the service as a bound Dagger Service argument:
   *
   *   --ocr tcp://<service-host>:8080 --pip-mirror tcp://<service-host>:3141 …
   */
  bindServiceArgs(): string[] {
    const args: string[] = [];
    for (const def of SERVICES) {
      const state = this.states.get(def.id);
      if (state?.status === "running" && def.daggerArg) {
        args.push(
          `--${def.daggerArg}`,
          `tcp://${this.serviceHost}:${def.ports[0]}`,
        );
      }
    }
    return args;
  }

  /**
   * Like bindServiceArgs(), but only includes args accepted by the selected
   * pipeline function.
   */
  bindServiceArgsForFunction(fnName: string): string[] {
    const accepted = this.getAcceptedFlags(fnName);
    const args: string[] = [];
    for (const def of SERVICES) {
      const state = this.states.get(def.id);
      if (
        state?.status === "running" &&
        def.daggerArg &&
        accepted.has(def.daggerArg)
      ) {
        args.push(
          `--${def.daggerArg}`,
          `tcp://${this.serviceHost}:${def.ports[0]}`,
        );
      }
    }
    return args;
  }

  private getAcceptedFlags(fnName: string): Set<string> {
    const cached = this.acceptedFlagsCache.get(fnName);
    if (cached) {
      return cached;
    }

    const cwd = this.resolvePipelinesDir();
    if (!cwd) {
      return new Set<string>();
    }

    const res = cp.spawnSync("dagger", ["call", fnName, "--help"], {
      cwd,
      env: { ...process.env, DAGGER_NO_NAG: "1" },
      encoding: "utf8",
      timeout: 15000,
    });

    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const flags = new Set<string>();

    const argsSection = out.split(/\nARGUMENTS\n/i)[1] ?? out;
    for (const m of argsSection.matchAll(/--([a-z0-9][a-z0-9-]*)/gi)) {
      flags.add(m[1].toLowerCase());
    }

    this.acceptedFlagsCache.set(fnName, flags);
    return flags;
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

    // Free any stale process (e.g. from a previous VS Code session) that is
    // still holding the service's host port.  fuser -k sends SIGKILL to the
    // holder; failure (port already free, fuser unavailable) is silently ignored.
    for (const port of def.ports) {
      cp.spawnSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
    }

    const pipelinesDir = this.resolvePipelinesDir();
    const proc = cp.spawn("dagger", ["call", def.daggerFn, "up"], {
      cwd: pipelinesDir,
      env: { ...process.env, DAGGER_NO_NAG: "1" },
      // detached=true gives the child its own process group so that when we stop
      // the service we can send SIGTERM to the whole group (process.kill(-pgid)).
      // This ensures the Dagger port-forwarder subprocess also exits, releasing
      // the host TCP tunnel immediately.
      detached: true,
    });
    // Unref so the VS Code process itself is not kept alive by this child.
    proc.unref();

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

    // Kill the entire process group (negative PID) so that Dagger's child
    // port-forwarder processes are also terminated and release the host TCP
    // tunnel immediately.  Fallback to killing just the process if the pid is
    // unavailable for any reason.
    try {
      if (state.process.pid !== undefined) {
        process.kill(-state.process.pid, "SIGTERM");
      } else {
        state.process.kill("SIGTERM");
      }
    } catch {
      state.process.kill("SIGTERM");
    }
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
