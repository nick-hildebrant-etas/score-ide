export interface ServiceDef {
  id: string;
  label: string;
  daggerFn: string;
  /** Host ports the service exposes (first is used in envVars). */
  ports: number[];
  /**
   * Environment variables to inject into the `dagger call` terminal when this
   * service is running. Dagger reads these from its process environment and
   * exports engine-level traces / metrics automatically — no pipeline-function
   * changes required.
   */
  envVars?: Record<string, string>;
}

export const SERVICES: ServiceDef[] = [
  {
    id: 'otel-webui',
    label: 'OTel Web UI',
    daggerFn: 'otel-webui',
    ports: [4318],
    envVars: {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_METRICS_EXPORTER: 'none',
    },
  },
  {
    id: 'ocr',
    label: 'OCR',
    daggerFn: 'ocr',
    ports: [8080],
  },
  {
    id: 'pip-mirror',
    label: 'PyPI Mirror',
    daggerFn: 'pip-mirror',
    ports: [3141],
  },
  {
    id: 'bazel-remote-cache',
    label: 'Bazel Remote Cache',
    daggerFn: 'bazel-remote-cache',
    ports: [9090],
  },
];
