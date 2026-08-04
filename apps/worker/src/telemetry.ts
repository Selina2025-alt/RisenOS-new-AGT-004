import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

export async function startTelemetry(serviceName: string) {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return undefined;
  }
  process.env.OTEL_SERVICE_NAME ||= serviceName;
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: Number.parseInt(
        process.env.OTEL_METRIC_EXPORT_INTERVAL_MS ?? "30000",
        10,
      ),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  return sdk;
}
