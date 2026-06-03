const fs = require('fs');
const path = require('path');
const { initTracing, startSpan, endSpan } = require('../otel-tracing');
const http = require('http');

// Compteurs réels de requêtes — incrémentés au fur et à mesure
const httpCounters = {
    success: 0,
    error500: 0
};

// Simule un endpoint Spring Boot Actuator /actuator/prometheus
const metricsServer = http.createServer((req, res) => {
    if (req.url === '/actuator/prometheus') {
        const uptime = process.uptime();
        const mem = process.memoryUsage();

        res.writeHead(200, { 'Content-Type': 'text/plain' });

        res.end([
            `# HELP jvm_memory_used_bytes Simulated JVM memory`,
            `# TYPE jvm_memory_used_bytes gauge`,
            `jvm_memory_used_bytes{area="heap"} ${mem.heapUsed}`,
            `jvm_memory_used_bytes{area="nonheap"} ${mem.external}`,

            `# HELP process_uptime_seconds Process uptime`,
            `# TYPE process_uptime_seconds gauge`,
            `process_uptime_seconds ${uptime}`,

            `# HELP http_requests_total Simulated HTTP requests`,
            `# TYPE http_requests_total counter`,
            `http_requests_total{status="200",service="${process.env.SERVICE_NAME || 'unknown'}"} ${httpCounters.success}`,
            `http_requests_total{status="500",service="${process.env.SERVICE_NAME || 'unknown'}"} ${httpCounters.error500}`,
        ].join('\n'));

    } else {
        res.writeHead(404);
        res.end();
    }
});

metricsServer.listen(8080, () =>
    console.log('Actuator mock sur :8080/actuator/prometheus')
);

initTracing('middle');

const LOG_FILE = '/logs/middle/middleware.log';
const PID = 2616688;

const logDir = path.dirname(LOG_FILE);

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const THREADS_HTTP = [
    'http-nio-9999-exec-1',
    'http-nio-9999-exec-2',
    'http-nio-9999-exec-3'
];

const THREADS_BATCH = ['scheduling-1'];

const ENDPOINTS = [
    '/api/auth',
    '/api/users',
    '/api/payments',
    '/api/status'
];

const ORIGINS = [
    'CORPORATE',
    'MOBILE'
];

const CLIENT_IPS = [
    '192.168.127.108',
    '192.168.127.110'
];

/* =========================================================
   STATUS SCENARIOS
========================================================= */

const STATUS_SCENARIOS = [
    { code: 200, level: 'INFO',  weight: 78 },
    { code: 400, level: 'WARN',  weight: 5  },
    { code: 401, level: 'WARN',  weight: 4  },
    { code: 403, level: 'WARN',  weight: 3  },
    { code: 404, level: 'WARN',  weight: 3  },
    { code: 422, level: 'WARN',  weight: 2  },
    { code: 500, level: 'ERROR', weight: 3  },
    { code: 503, level: 'ERROR', weight: 2  },
];

function pickStatus() {
    const total = STATUS_SCENARIOS.reduce((sum, item) => sum + item.weight, 0);

    let r = Math.random() * total;

    for (const scenario of STATUS_SCENARIOS) {
        r -= scenario.weight;

        if (r <= 0) {
            return scenario;
        }
    }

    return STATUS_SCENARIOS[0];
}

/* =========================================================
   EXCEPTIONS PAR CODE
========================================================= */

const EXCEPTIONS = {

    400: [
        'BadRequestException',
        'InvalidParameterException',
        'MissingFieldException'
    ],

    401: [
        'UnauthorizedException',
        'TokenExpiredException',
        'AuthenticationServiceException'
    ],

    403: [
        'ForbiddenException',
        'AccessDeniedException',
        'InsufficientPrivilegesException'
    ],

    404: [
        'ResourceNotFoundException',
        'UserNotFoundException',
        'EndpointNotFoundException'
    ],

    422: [
        'ValidationException',
        'DataIntegrityViolationException',
        'InvalidStateException'
    ],

    500: [
        'InternalServerErrorException',
        'NullPointerException',
        'DatabaseConnectionException',
        'ServiceTimeoutException',
        'TransactionRollbackException',
        'OutOfMemoryError'
    ],

    503: [
        'ServiceUnavailableException',
        'CircuitBreakerOpenException',
        'DependencyFailureException'
    ]
};

function pickException(code) {

    const list = EXCEPTIONS[code] || EXCEPTIONS[500];

    return list[Math.floor(Math.random() * list.length)];
}

function timestamp() {
    return new Date().toISOString();
}

function writeLog(line) {
    fs.appendFileSync(LOG_FILE, line + '\n');
}

function formatLogLine(level, thread, logger, message, traceId = null) {

    const paddedLevel = level.padEnd(5, ' ');
    const traceIdPart = traceId
        ? ` [trace_id=${traceId}]`
        : '';

    return `${timestamp()}${traceIdPart}  ${paddedLevel} ${PID} --- [${thread}] ${logger.padEnd(45, ' ')} : ${message}`;
}

/* =========================================================
   HTTP REQUEST GENERATOR
========================================================= */

function generateHttpRequest() {

    const thread   = THREADS_HTTP[Math.floor(Math.random() * THREADS_HTTP.length)];
    const endpoint = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
    const origin   = ORIGINS[Math.floor(Math.random() * ORIGINS.length)];
    const ip       = CLIENT_IPS[Math.floor(Math.random() * CLIENT_IPS.length)];

    const picked = pickStatus();

    const status = picked.code;
    const level  = picked.level;

    if (status >= 500) {
        httpCounters.error500++;
    } else {
        httpCounters.success++;
    }

    const duration = Math.floor(Math.random() * 100) + 'ms';

    const { span, traceId } = startSpan(`HTTP GET ${endpoint}`, {
        'http.method': 'GET',
        'http.url': endpoint
    });

    // Ligne principale
    writeLog(
        formatLogLine(
            level,
            thread,
            'LoggingFilter',
            `Request URI : ${endpoint} [${status}]`,
            traceId
        )
    );

    // Bloc visualisation
    writeLog('╔═══════════════════════ VISUALIZE LOG ═══════════════════════╗');

    writeLog(
        `🧾 Method : GET  │ 🌍 Request URI : ${endpoint} │ 💻 Client IP : ${ip}`
    );

    if (status !== 200) {

        const exc = pickException(status);

        writeLog(
            `🔢 Response Code : ${status}  │ 🔥 Exception : ${exc}  │ ⏱️ Duration : ${duration}  │ 📍 Origin : ${origin}`
        );

    } else {

        writeLog(
            `🔢 Response Code : ${status}  │ ⏱️ Duration : ${duration}  │ 📍 Origin : ${origin}`
        );
    }

    writeLog('╚═══════════════════════════════════════════════════════════════╝');

    endSpan(span, status);
}

/* =========================================================
   BATCH JOB
========================================================= */

function generateBatchJob() {

    const thread = THREADS_BATCH[0];

    const logger = 's.c.t.m.s.b.ExecutePlannedOperationJob';

    writeLog(
        formatLogLine(
            'INFO',
            thread,
            logger,
            `BATCH RUNNING - Periodic sync`
        )
    );
}

console.log('🚀 Mock middle démarré');

setInterval(generateHttpRequest, 3000);
setInterval(generateBatchJob, 60000);

generateBatchJob();