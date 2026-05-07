'use strict';
import { IncomingMessage } from 'node:http';

import { trace } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';
import {
  envDetector,
  processDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { k8s, version } from './configs/otlp.config.env';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  ATTR_K8S_NAMESPACE_NAME,
  ATTR_K8S_NODE_NAME,
  ATTR_K8S_POD_NAME,
} from './semconv';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';

type OTLPTraceExporterParam = ConstructorParameters<
  typeof OTLPTraceExporter
>[0];

interface OtlpSdkOptions {
  exporterUrl: string;
  ignoreIncomingRequestUrls?: string[];
}

/** Last SDK instance from {@link default}; {@link shutdownOtlpSdk} shuts this down (same instance as `.start()`). */
let activeOtlpSdk: NodeSDK | undefined;

function buildOtlpNodeSdk(options: OtlpSdkOptions): NodeSDK {
  const defaultIgnoreIncomingRequestUrls = [
    '/health',
    '/metrics',
    '/health/readiness',
    '/health/liveness',
    '/healthz',
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
      mergedIgnoreIncomingRequestUrls.has(req.url ?? ''),
  };
  const traceExporter = new OTLPTraceExporter(traceExporterOptions);

  const spanProcessor = new BatchSpanProcessor(traceExporter);
  return new NodeSDK({
    spanProcessors: [spanProcessor],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': httpInstrumentConfig,
        '@opentelemetry/instrumentation-kafkajs': { enabled: true },
      }),
      new NestInstrumentation(),
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
}

const otlpSdk = (options: OtlpSdkOptions) => {
  if (activeOtlpSdk) {
    return activeOtlpSdk;
  }
  const sdk = buildOtlpNodeSdk(options);
  sdk.start();
  activeOtlpSdk = sdk;

  const shutdown = () => {
    void shutdownOtlpSdk().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return sdk;
};

export async function shutdownOtlpSdk(): Promise<void> {
  if (!activeOtlpSdk) {
    return;
  }
  const sdk = activeOtlpSdk;
  activeOtlpSdk = undefined;
  await sdk.shutdown();
}

export default otlpSdk;

export const tracer = trace.getTracer(k8s.serviceName as string);
