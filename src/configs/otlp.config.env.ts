export const otlpExporterUrl = process.env.OTLP_EXPORTER_URL;

export const k8s = {
  serviceName: process.env.SERVICE_NAME,
  nodeName: process.env.NODE_NAME,
  podName: process.env.POD_NAME,
  namespace: process.env.POD_NAMESPACE,
};

export const version = process.env.VERSION;
