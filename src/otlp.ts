'use strict';
import { trace } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';
import {
  envDetector,
  processDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { IncomingMessage } from 'node:http';

import { k8s, version } from './configs/otlp.config.env';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  ATTR_K8S_NAMESPACE_NAME,
  ATTR_K8S_NODE_NAME,
  ATTR_K8S_POD_NAME,
} from './semconv';

type OTLPTraceExporterParam = ConstructorParameters<
  typeof OTLPTraceExporter
>[0];

interface OtlpSdkOptions {
  exporterUrl: string;
  ignoreIncomingRequestUrls?: string[];
}

const otlpSdk = (options: OtlpSdkOptions) => {
  const defaultIgnoreIncomingRequestUrls = [
    '/health',
    '/healthz',
    '/metrics',
    '/health/readiness',
    '/health/liveness',
  ];
  const { exporterUrl, ignoreIncomingRequestUrls } = options;
  const mergedIgnoreIncomingRequestUrls = new Set([
    ...defaultIgnoreIncomingRequestUrls,
    ...(ignoreIncomingRequestUrls ?? []),
  ]);
  const traceExporterOptions: OTLPTraceExporterParam = {
    url: exporterUrl,
  };
  const httpInstrumentConfig: HttpInstrumentationConfig = {
    enabled: true,
    ignoreIncomingRequestHook: (req: IncomingMessage) =>
      mergedIgnoreIncomingRequestUrls.has(req.url as string),
  };
  const traceExporter = new OTLPTraceExporter(traceExporterOptions);
  const spanProcessor = new tracing.BatchSpanProcessor(traceExporter);
  return new NodeSDK({
    traceExporter,
    spanProcessor,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': httpInstrumentConfig,
        '@opentelemetry/instrumentation-nestjs-core': { enabled: true },
        '@opentelemetry/instrumentation-kafkajs': { enabled: true },
      }),
    ],
    resourceDetectors: [envDetector, processDetector],
    resource: resourceFromAttributes({
      [ATTR_SERVICE_VERSION]: version,
      [ATTR_DEPLOYMENT_ENVIRONMENT]: k8s.namespace,
      [ATTR_K8S_NODE_NAME]: k8s.nodeName,
      [ATTR_K8S_POD_NAME]: k8s.podName,
      [ATTR_K8S_NAMESPACE_NAME]: k8s.namespace,
    }),
    serviceName: k8s.serviceName,
  });
};

export default otlpSdk;

export const tracer = trace.getTracer(k8s.serviceName as string);
