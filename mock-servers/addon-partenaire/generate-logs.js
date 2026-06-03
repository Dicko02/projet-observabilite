/*
  Mock addon-partenaire — Version 1 avec OpenTelemetry.
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

const LOG_DIR = '/logs/addon-partenaire';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `addon-partenaire-${date}_log.log`);
}

initTracing('addon-partenaire');

const PID     = process.pid.toString();
const APP     = 'partenaire';
const THREADS = Array.from({ length: 8 }, (_, i) => `http-nio-1212-exec-${i + 1}`);

const LOGGERS = {
    httpLog:     's.c.p.config.logs.HttpLoggingFilter',
    versusImpl:  's.c.p.v.v.s.impl.VersusServiceImpl',
    versusAuth:  's.c.p.v.v.a.VersusAuthenticationService',
    versusClient:'s.c.p.v.versus.config.VersusClient',
    niirpay:     's.c.p.b.niirpay.service.NiirpayClient',
    billReq:     's.c.p.b.datas.dto.BillPaymentRequest',
};

const PAYMENT_REFS = ['rgJkLv', 'CuCQBF', 'Xm7kPq', 'BnR2sT', 'Yz9wKj'];

const ENDPOINTS = [
    {
        method: 'GET',
        pathFn: () => `/api/v1/versus/payment/${randomFrom(PAYMENT_REFS)}/status`,
        partner: 'VERSUS',
        codes: [
            { code: 200, weight: 70 },
            { code: 404, weight: 15 },
            { code: 500, weight: 15 }
        ]
    },

    {
        method: 'POST',
        pathFn: () => '/api/bills/payment',
        partner: 'NIIRPAY',
        codes: [
            { code: 200, weight: 70 },
            { code: 400, weight: 20 },
            { code: 503, weight: 10 }
        ]
    },

    {
        method: 'POST',
        pathFn: () => '/api/v1/orange-money/payment',
        partner: 'ORANGE_MONEY',
        codes: [
            { code: 200, weight: 65 },
            { code: 422, weight: 15 },
            { code: 500, weight: 15 },
            { code: 503, weight: 5 }
        ]
    },

    {
        method: 'GET',
        pathFn: () => '/api/v1/keyzen/status',
        partner: 'KEYZEN',
        codes: [
            { code: 200, weight: 75 },
            { code: 401, weight: 10 },
            { code: 403, weight: 5 },
            { code: 500, weight: 10 }
        ]
    },
];

const PARTNERS_ERRORS = {
    NIIRPAY:      ['Biller not authorized', 'Service unavailable. Please try again later', 'Biller not found'],
    VERSUS:       ['Payment not found', 'Authentication failed', 'Timeout'],
    ORANGE_MONEY: ['Insufficient balance', 'Invalid phone number', 'Service temporarily unavailable'],
    KEYZEN:       ['Certificate expired', 'Connection refused'],
};

const PARTENAIRE_EXCEPTIONS = {

    VERSUS: {
        404: 'ResourceNotFoundException',
        500: 'RestClientException'
    },

    NIIRPAY: {
        400: 'BadRequestException',
        503: 'ServiceUnavailableException'
    },

    ORANGE_MONEY: {
        422: 'ValidationException',
        500: 'PaymentGatewayException',
        503: 'ServiceUnavailableException'
    },

    KEYZEN: {
        401: 'UnauthorizedException',
        403: 'CertificateException',
        500: 'CertificateException'
    },
};

const BILLERS = [
    { name: 'Orange - Airtime v3', id: 'b451b4f3-ad34-46d7', nature: 'TOPUP'        },
    { name: 'start times',          id: 'b01a0727-7b68-4300', nature: 'CONTRACT'     },
    { name: 'Senelec',              id: 'c782a3f1-9d12-5500', nature: 'BILL'         },
    { name: 'Canal+',               id: 'd901b2e4-1a23-6600', nature: 'SUBSCRIPTION' },
];

const CLIENT_IPS = ['192.168.215.74', '192.168.215.75', '10.10.0.5'];
const AGENTS = ['PostmanRuntime/7.53.0', 'axios/1.4.0', 'okhttp/4.11.0'];

function weighted(arr) {
    const total = arr.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    for (const x of arr) { r -= x.weight; if (r <= 0) return x; }
    return arr[0];
}
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function now()           { return new Date().toISOString(); }
function writeLine(line) { fs.appendFileSync(getLogFile(), line + '\n'); }

// Format standard partenaire : TIMESTAMP  LEVEL PID --- [app] [thread] logger : message
function logLine(ts, level, thread, logger, message, traceId = null) {
    const tidPart = traceId ? ` [trace_id=${traceId}]` : '';
    writeLine(`${ts}${tidPart}  ${level.padEnd(5)} ${PID} --- [${APP}] [${thread}] ${logger.padEnd(44)}: ${message}`);
}

async function generateRequest() {
    const ep     = randomFrom(ENDPOINTS);
    const uri    = ep.pathFn();
    const ip     = randomFrom(CLIENT_IPS);
    const agent  = randomFrom(AGENTS);
    const thread = randomFrom(THREADS);
    const result = weighted(ep.codes);
    if (result.code >= 500) httpCounters.error500++;
    else httpCounters.success++;
    const duration = Math.floor(200 + Math.random() * 9000);
    const ts     = now();

    const { span, traceId } = startSpan(`HTTP ${ep.method} ${uri}`, {
        'http.method': ep.method,
        'http.url':    uri,
        'http.client_ip': ip,
        'custom.partner': ep.partner,
        'service.name': 'addon-partenaire'
    });

    // Logs applicatifs spécifiques au partenaire
    if (ep.partner === 'VERSUS') {
        const ref = uri.split('/')[5] || randomFrom(PAYMENT_REFS);
        logLine(ts, 'INFO',  thread, LOGGERS.versusImpl, `REQUEST DATA PAYMENT STATUS ${ref}`, traceId);
        logLine(ts, 'INFO',  thread, LOGGERS.versusAuth, 'Authentification Versus réussie', traceId);
        if (result.code === 200) {
            logLine(ts, 'INFO', thread, LOGGERS.versusClient,
                `[VersusClient] Réponse reçue pour /api/payment/${ref}`, traceId);
        } else {
            const err = randomFrom(PARTNERS_ERRORS.VERSUS);
            logLine(ts, 'ERROR', thread, LOGGERS.versusClient,
                `[VersusClient] Impossible de désérialiser: ${err}`, traceId);
            writeLine(`org.springframework.web.client.RestClientException: ${err}`);
            writeLine(`\tat org.springframework.web.client.RestTemplate.execute(RestTemplate.java:724)`);
            writeLine(`\tat s.c.p.v.versus.config.VersusClient.getPaymentStatus(VersusClient.java:87)`);
        }
    } else if (ep.partner === 'NIIRPAY') {
        const biller = randomFrom(BILLERS);
        logLine(ts, 'INFO', thread, LOGGERS.billReq, 'DEBUT REQUEST VENANT DU MIDDLE POUR', traceId);
        logLine(ts, 'INFO', thread, LOGGERS.billReq, `Partner name: NIIRPAY`, traceId);
        logLine(ts, 'INFO', thread, LOGGERS.billReq, `Biller Name: ${biller.name}`, traceId);
        logLine(ts, 'INFO', thread, LOGGERS.billReq, `Biller Id: ${biller.id}`, traceId);
        logLine(ts, 'INFO', thread, LOGGERS.billReq, `Biller Nature: ${biller.nature}`, traceId);
        logLine(ts, 'INFO', thread, LOGGERS.billReq, 'FIN REQUEST VENANT DU MIDDLE POUR', traceId);
        logLine(ts, 'INFO', thread, LOGGERS.niirpay, 'NIIRPAY PAYMENT', traceId);
        const err = randomFrom(PARTNERS_ERRORS.NIIRPAY);
        logLine(ts, 'INFO', thread, LOGGERS.niirpay,
            `ErrorResponse: "400 Bad Request: \\"{\"errorcode\": 6401, \\"errormessage\\": \\"${err}\\", \\"meta\\": {}}\""`, traceId);
    }

    // Bloc HTTP INBOUND
    // logLine ci-dessous = ancre timestamp pour Fluent Bit multiline
    const inTs = now();
    logLine(inTs, 'INFO', thread, LOGGERS.httpLog, '', traceId);
    writeLine(`┏━━━━━━━━━━━━━━━━━━━━━━━━  HTTP INBOUND REQUEST  ━━━━━━━━━━━━━━━━━━━━━━━━┓`);
    writeLine(`┃ 🧩 trace_id ${traceId.padEnd(60)}┃`);
    writeLine(`┃ 👤 IP    ${ip.padEnd(63)}┃`);
    writeLine(`┃ 🛣️      ${ep.method} ${uri.padEnd(63)}┃`);
    writeLine(`┃    Request URI : ${uri}`.padEnd(73) + `┃`);
    writeLine(`┃                                                                       ┃`);
    writeLine(`┃ 🧷 Headers                                                             ┃`);
    writeLine(`┃    • User-Agent : ${agent.padEnd(53)}┃`);
    writeLine(`┃    • Accept     : */*                                                 ┃`);
    if (ep.method === 'POST') {
        const biller = randomFrom(BILLERS);
        const bodyJson = JSON.stringify({
            biller_name: biller.name,
            partner: ep.partner,
            amount: Math.floor(100 + Math.random() * 50000)
        }, null, 2);
        writeLine(`┃ 📨 Body                                                                ┃`);
        for (const line of bodyJson.split('\n')) {
            writeLine(`┃    ${line.padEnd(67)}┃`);
        }
    } else {
        writeLine(`┃ 📨 Body (0 B)                                                          ┃`);
    }
    writeLine(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);

    // Bloc HTTP OUTBOUND
    // logLine ci-dessous = nouvelle ancre timestamp — cet événement contient
    // Request URI + Response Code + Exception dans le même événement Fluent Bit
    // → les 3 labels peuvent être extraits par la même query Loki
    const outTs = now();
    const isMetierError = ep.partner === 'NIIRPAY';
    const displayCode   = isMetierError
        ? '200 OK (erreur métier)'
        : `${result.code} ${result.code === 200 ? 'OK' : 'Internal Server Error'}`;

    logLine(outTs, 'INFO', thread, LOGGERS.httpLog, '', traceId);
    writeLine(`┏━━━━━━━━━━━━━━━━━━━━━━━  HTTP OUTBOUND RESPONSE  ━━━━━━━━━━━━━━━━━━━━━━━┓`);
    writeLine(`┃    Request URI : ${uri}`.padEnd(73) + `┃`);
    writeLine(`┃ ${result.code === 200 ? '✅' : '💥'}        ${displayCode.padEnd(65)}┃`);
    if (result.code >= 400) {

        const excMap = PARTENAIRE_EXCEPTIONS[ep.partner] || {};

        const excName = excMap[result.code] || 'ServiceException';

        writeLine(
            `┃    Response Code : ${result.code} | Exception : ${excName}`
                .padEnd(73) + `┃`
        );

    } else {

        writeLine(
            `┃    Response Code : ${result.code}`
                .padEnd(73) + `┃`
        );
    }
    writeLine(`┃ ⏱️  duration ${String(duration + ' ms').padEnd(59)}┃`);
    writeLine(`┃ 🧩 trace_id ${traceId.padEnd(60)}┃`);
    writeLine(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);

    endSpan(span, result.code, { 'http.response_duration_ms': duration, 'custom.partner': ep.partner });
}

console.log('🚀 Mock addon-partenaire v1 (OTel) démarré →', LOG_DIR);

function scheduleNext() {
    setTimeout(() => { generateRequest().catch(console.error); scheduleNext(); }, 4000 + Math.random() * 3000);
}
scheduleNext();