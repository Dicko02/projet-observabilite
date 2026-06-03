/*
  Mock addon-voucher — Version 2 avec trace_id W3C sur chaque ligne.
*/

const fs   = require('fs');
const path = require('path');
const { initTracing, startSpan, endSpan } = require('../otel-tracing');
const http = require('http');

// Compteurs réels de requêtes — incrémentés au fur et à mesure
const httpCounters = { success: 0, error500: 0 };

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
    res.writeHead(404); res.end();
  }
});
metricsServer.listen(8080, () => console.log('Actuator mock sur :8080/actuator/prometheus'));

const LOG_DIR = '/logs/addon-voucher';
initTracing('addon-voucher');

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile() {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `addon-voucher-${date}_log.log`);
}

const ANSI = {
    DIM:     '\x1b[2m',
    MAGENTA: '\x1b[35m',
    CYAN:    '\x1b[36m',
    YELLOW:  '\x1b[33m',
    GREEN:   '\x1b[32m',
    RED:     '\x1b[31m',
    ORANGE:  '\x1b[33m',
    RESET:   '\x1b[0;39m',
};

const SEP = ' ................... ';

const THREADS_HTTP = [
    'http-nio-9090-exec-1', 'http-nio-9090-exec-2', 'http-nio-9090-exec-3',
    'http-nio-9090-exec-4', 'http-nio-9090-exec-5', 'http-nio-9090-exec-6',
    'http-nio-9090-exec-7', 'http-nio-9090-exec-8', 'http-nio-9090-exec-9',
    'http-nio-9090-exec-10'
];
const THREAD_BATCH = 'scheduling-1';

const LOGGERS = {
    bootstrap:    's.c.v.c.A.b.BootstrapLockdownFilter',
    appAuth:      's.c.v.c.A.w.AppAuthenticationFilter',
    replay:       's.c.v.c.A.web.ReplayProtectionFilter',
    jwt:          's.c.v.c.A.s.JwtAuthenticationFilter',
    rateLimit:    's.c.v.c.A.web.RateLimitingFilter',
    httpLog:      's.c.v.c.u.c.logs.HttpLoggingFilter',
    acquirerSvc:  's.c.v.c.s.a.AcquirerServiceImpl',
    acquirerHelp: 's.c.v.c.s.a.helpers.AcquirerHelper',
    voucherSvc:   's.c.v.c.s.v.VoucherServiceImpl',
    batchJob:     's.c.v.c.b.SyncAcquirerJob',
};

const ENDPOINTS = [
    { method: 'POST', path: '/api/v1/voucher/acquirer'           },
    { method: 'GET',  path: '/api/v1/voucher/acquirer'           },
    { method: 'POST', path: '/api/v1/voucher/recharge'           },
    { method: 'GET',  path: '/api/v1/voucher/transaction/status' },
    { method: 'POST', path: '/api/v1/voucher/cancel'             },
    { method: 'GET',  path: '/api/v1/voucher/balance'            },
];

const CLIENT_IPS = ['192.168.127.108', '192.168.127.110', '10.0.0.5', '172.16.0.22'];

const HTTP_STATUSES = [
    { code: 200, label: '200 OK',                     icon: '✅', level: 'INFO',  weight: 65 },
    { code: 201, label: '201 Created',                icon: '✅', level: 'INFO',  weight: 15 },

    { code: 400, label: '400 Bad Request',            icon: '❌', level: 'WARN',  weight: 8  },
    { code: 401, label: '401 Unauthorized',           icon: '🔒', level: 'WARN',  weight: 5  },
    { code: 403, label: '403 Forbidden',              icon: '🚫', level: 'WARN',  weight: 3  },
    { code: 404, label: '404 Not Found',              icon: '❌', level: 'WARN',  weight: 4  },
    { code: 422, label: '422 Unprocessable Entity',   icon: '❌', level: 'WARN',  weight: 2  },

    { code: 500, label: '500 Internal Server Error',  icon: '💥', level: 'ERROR', weight: 3  },
    { code: 503, label: '503 Service Unavailable',    icon: '💥', level: 'ERROR', weight: 2  },
];

const VOUCHER_EXCEPTIONS = {

    400: 'BadRequestException',

    401: 'UnauthorizedException',

    403: 'ForbiddenException',

    404: 'ResourceNotFoundException',

    422: 'ValidationException',

    500: 'InternalServerErrorException',

    503: 'ServiceUnavailableException',
};

function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function weightedStatus() {
    const total = HTTP_STATUSES.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    for (const s of HTTP_STATUSES) { r -= s.weight; if (r <= 0) return s; }
    return HTTP_STATUSES[0];
}

function generateAcquirerCode() {
    return String(Math.floor(100000 + Math.random() * 899999));
}

function writeLog(line) {
    fs.appendFileSync(getLogFile(), line + '\n');
}

function timestamp() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatLine(ts, thread, level, logger, message, traceId = null) {
    const levelColor = level === 'ERROR' ? ANSI.RED
                     : level === 'WARN'  ? ANSI.ORANGE
                     : ANSI.CYAN;
    const traceIdPart = traceId ? ` [trace_id=${traceId}]` : '';
    return (
        `${ANSI.DIM}${ts}${ANSI.RESET}${traceIdPart}${SEP}` +
        `${ANSI.MAGENTA}[${thread}]${ANSI.RESET}${SEP}` +
        `${levelColor}${level.padEnd(5)}${ANSI.RESET}${SEP}` +
        `${ANSI.YELLOW}${logger}${ANSI.RESET}${SEP}` +
        `${ANSI.GREEN}${message}${ANSI.RESET}`
    );
}

function generateHttpRequest() {
    const thread   = randomFrom(THREADS_HTTP);
    const endpoint = randomFrom(ENDPOINTS);
    const ip       = randomFrom(CLIENT_IPS);
    const status   = weightedStatus();
    if (status.code >= 500) httpCounters.error500++;
    else httpCounters.success++;
    const duration = Math.floor(5 + Math.random() * 150);
    const ts       = timestamp();
    const shortPath = endpoint.path.replace('/api', '');

    const { span, traceId } = startSpan(`HTTP ${endpoint.method} ${endpoint.path}`, {
        'http.method': endpoint.method,
        'http.url':    endpoint.path
    });

    // Pipeline de filtres
    writeLog(formatLine(ts, thread, 'INFO', LOGGERS.bootstrap, 'Bootstrap lockdown filter', traceId));
    writeLog(formatLine(ts, thread, 'INFO', LOGGERS.bootstrap, `DISABLED BOOTSTRAP PATH: ${shortPath}`, traceId));
    writeLog(formatLine(ts, thread, 'INFO', LOGGERS.appAuth,   'App authentication filter', traceId));
    writeLog(formatLine(ts, thread, 'INFO', LOGGERS.appAuth,   `URI /api${shortPath}`, traceId));
    writeLog(formatLine(ts, thread, 'INFO', LOGGERS.replay,    `Skip replay protection for ${shortPath}`, traceId));
    writeLog(formatLine(ts, thread, 'INFO', LOGGERS.jwt,       `Skip JWT authentication for ${shortPath}`, traceId));
    writeLog(formatLine(ts, thread, 'INFO', LOGGERS.rateLimit, `Skip rate limiting for ${shortPath}`, traceId));

    // Logique métier
    if (endpoint.path.includes('acquirer') && endpoint.method === 'POST') {
        const code = generateAcquirerCode();
        if (status.code >= 400) {
            writeLog(formatLine(ts, thread, 'ERROR', LOGGERS.acquirerHelp,
                `The acquirer already exists, code : ${code}`, traceId));
        } else {
            writeLog(formatLine(ts, thread, 'INFO', LOGGERS.acquirerSvc,
                `Creating acquirer : { "code": "${code}", "status": "ACTIVE" }`, traceId));
        }
    } else if (endpoint.path.includes('recharge')) {
        const amount = Math.floor(Math.random() * 50000) + 1000;
        writeLog(formatLine(ts, thread, status.level, LOGGERS.voucherSvc,
            `Processing recharge of ${amount} XOF`, traceId));
    } else if (endpoint.path.includes('cancel')) {
        writeLog(formatLine(ts, thread, status.level, LOGGERS.voucherSvc,
            `Cancelling voucher transaction`, traceId));
    }

    // Bloc HTTP INBOUND
    // formatLine ci-dessous = ancre timestamp pour Fluent Bit multiline
    const tsIn = timestamp();
    writeLog(formatLine(tsIn, thread, 'INFO', LOGGERS.httpLog, '', traceId));
    writeLog(`┏━━━━━━━━━━━━━━━━━━━━━━━━  HTTP INBOUND REQUEST  ━━━━━━━━━━━━━━━━━━━━━━━━┓`);
    writeLog(`┃ 🧩 trace_id ${traceId.padEnd(60)}┃`);
    writeLog(`┃ 👤 IP       ${ip.padEnd(60)}┃`);
    writeLog(`┃ 🛣️         ${endpoint.method} ${endpoint.path.padEnd(57)}┃`);
    writeLog(`┃    Request URI : ${endpoint.path}`.padEnd(73) + `┃`);
    writeLog(`┃${''.padEnd(71)}┃`);
    writeLog(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);

    // Bloc HTTP OUTBOUND
    // formatLine ci-dessous = nouvelle ancre timestamp — cet événement contient
    // Request URI + Response Code + Exception dans le même événement Fluent Bit
    // → les 3 labels peuvent être extraits par la même query Loki
    const tsOut = timestamp();
    writeLog(formatLine(tsOut, thread, status.level, LOGGERS.httpLog, '', traceId));
    writeLog(`┏━━━━━━━━━━━━━━━━━━━━━━━  HTTP OUTBOUND RESPONSE  ━━━━━━━━━━━━━━━━━━━━━━━┓`);
    writeLog(`┃    Request URI : ${endpoint.path}`.padEnd(73) + `┃`);
    writeLog(`┃ ${status.icon}         ${status.label.padEnd(63)}┃`);
    if (status.code >= 400) {
        const excName = VOUCHER_EXCEPTIONS[status.code] || 'ServiceException';
        writeLog(`┃    Response Code : ${status.code} | Exception : ${excName}`.padEnd(73) + `┃`);
    } else {
        writeLog(`┃    Response Code : ${status.code}`.padEnd(73) + `┃`);
    }
    writeLog(`┃ ⏱️  duration ${String(duration + ' ms').padEnd(59)}┃`);
    writeLog(`┃ 🧩 trace_id ${traceId.padEnd(60)}┃`);
    writeLog(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);

    endSpan(span, status.code);
}

function generateBatchJob() {
    const { span, traceId } = startSpan('BATCH SyncAcquirerJob', { 'batch.type': 'scheduled' });
    const count = Math.floor(Math.random() * 50) + 10;
    const ts    = timestamp();

    writeLog(formatLine(ts, THREAD_BATCH, 'INFO', LOGGERS.batchJob, 'BATCH SYNC STARTED', traceId));
    writeLog(formatLine(ts, THREAD_BATCH, 'INFO', LOGGERS.batchJob,
        `Synchronizing ${count} acquirers from core banking`, traceId));
    writeLog(formatLine(ts, THREAD_BATCH, 'INFO', LOGGERS.batchJob,
        `BATCH SYNC COMPLETED - ${count} records processed`, traceId));

    endSpan(span, 200);
}

console.log('🚀 Mock addon-voucher v2 démarré — logs dans', LOG_DIR);

function scheduleNext() {
    setTimeout(() => {
        generateHttpRequest();
        scheduleNext();
    }, 3000 + Math.random() * 2000);
}

scheduleNext();
setInterval(generateBatchJob, 5 * 60 * 1000);
generateBatchJob();