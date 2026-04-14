export interface ServiceDef {
  id: string;
  label: string;
  daggerFn: string;
  /** Host ports the service exposes (first is used in envVars / daggerArg). */
  ports: number[];
  /**
   * Environment variables to inject into the `dagger call` terminal when this
   * service is running. Dagger reads these from its process environment and
   * exports engine-level traces / metrics automatically — no pipeline-function
   * changes required.
   */
  envVars?: Record<string, string>;
  /**
   * When set, the extension appends `--{daggerArg} tcp://{serviceHost}:{ports[0]}`
   * to every `dagger call` command while this service is running.  Use this
   * for services that pipeline functions accept as a Dagger `Service` argument
   * (e.g. `--ocr tcp://localhost:8080`).
   */
  daggerArg?: string;
  /** Path to open in the simple browser preview (default: "/"). */
  browserPath?: string;
}

export const SERVICES: ServiceDef[] = [
  {
    id: "otel-webui",
    label: "OTel Web UI",
    daggerFn: "otel-webui",
    ports: [4318],
    daggerArg: "otel",
    envVars: {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_METRICS_EXPORTER: "none",
    },
  },
  {
    id: "ocr",
    label: "OCI Registry",
    daggerFn: "ocr",
    ports: [5000],
    daggerArg: "ocr",
    browserPath: "/v2/",
  },
  {
    id: "pip-mirror",
    label: "PyPI Mirror",
    daggerFn: "pip-mirror",
    ports: [3141],
    daggerArg: "pip-mirror",
  },
  {
    id: "bazel-remote-cache",
    label: "Bazel Remote Cache",
    daggerFn: "bazel-remote-cache",
    ports: [9090],
    daggerArg: "bazel-remote-cache",
  },
];
