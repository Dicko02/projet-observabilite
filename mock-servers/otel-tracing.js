const { BasicTracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

let tracer = null;
let provider = null;

function initTracing(serviceName) {
    const url = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo:4318/v1/traces';
    console.log(`[OTel] Initialisation avec URL: ${url}`);
    
    const exporter = new OTLPTraceExporter({
        url: url,
        headers: { 'Content-Type': 'application/json' }
    });

    provider = new BasicTracerProvider({
        resource: new Resource({
            [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
            [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: 'dev'
        })
    });

    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();

    tracer = trace.getTracer(serviceName, '1.0.0');
    console.log(`[OTel] Tracing initialisé : "${serviceName}" → ${url}`);
}

function startSpan(operationName, attributes = {}) {
    if (!tracer) {
        const { randomBytes } = require('crypto');
        return { span: null, traceId: randomBytes(16).toString('hex') };
    }
    const span    = tracer.startSpan(operationName, { attributes });
    const traceId = span.spanContext().traceId;
    return { span, traceId };
}

function endSpan(span, statusCode) {
    if (!span) return;
    span.setAttribute('http.status_code', statusCode);
    span.setStatus(statusCode >= 500
        ? { code: SpanStatusCode.ERROR }
        : { code: SpanStatusCode.OK }
    );
    span.end();
}

module.exports = { initTracing, startSpan, endSpan };