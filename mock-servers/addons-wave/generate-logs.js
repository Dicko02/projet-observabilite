/*
  Mock addons-wave — Spring Boot, Wave (port 8989)
  Format : TIMESTAMP [trace_id=xxx] LEVEL PID --- [thread] logger : message
  OTel activé. Toutes les erreurs 4xx et 5xx simulées.
*/

const fs   = require('fs');
const path = require('path');
const { initTracing, startSpan, endSpan } = require('../otel-tracing');
const http = require('http');

const LOG_DIR = '/logs/addons-wave';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const httpCounters = { success: 0, error4xx: 0, error500: 0 };

const metricsServer = http.createServer((req, res) => {
    if (req.url === '/actuator/prometheus') {
        const uptime = process.uptime();
        const mem    = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end([
            `# HELP http_requests_total Simulated HTTP requests`,
            `# TYPE http_requests_total counter`,
            `http_requests_total{status="200",service="${process.env.SERVICE_NAME||'unknown'}"} ${httpCounters.success}`,
            `http_requests_total{status="500",service="${process.env.SERVICE_NAME||'unknown'}"} ${httpCounters.error500}`,
            `# HELP process_uptime_seconds Process uptime`,
            `# TYPE process_uptime_seconds gauge`,
            `process_uptime_seconds ${process.uptime()}`,
        ].join('\n'));
    } else { res.writeHead(404); res.end(); }
});
metricsServer.listen(8080, () => console.log('Actuator mock sur :8080/actuator/prometheus'));

initTracing('addons-wave');

const PID           = '2374616';
const PORT          = '8989';
const INTERNAL_HOST = 'http://192.168.122.115:9999';
const DTO_PKG       = 'sn.cms.aw';

// Thread numbers élevés comme dans les vrais logs (exec-2094, exec-2120...)
const BASE_THREAD = 2000;
const THREADS = Array.from({ length: 80 },
    (_, i) => `http-nio-${PORT}-exec-${BASE_THREAD + i + 1}`);

const LOGGERS = {
    rest:         'o.s.web.client.RestTemplate           ',
    errorHandler: 's.c.a.e.RestTemplateErrorHandler     ',
    middleware:   `${DTO_PKG}.services.MiddlewareService `,
};

// Pool FIXE de comptes — évite l'explosion de séries uniques dans topk du dashboard ← MODIFIÉ
const FIXED_ACCOUNTS = [
    'CMSBSNDA00030800029169', 'CMSBSNDA00040900123713', 'CMSBSNDA00000400647480',
    'CMSBSNDB00021300087654', 'CMSBSNDB00012100054321', 'CMSBSNDC00087600034512',
    'CMSBSNDA00050100073014', 'CMSBSNDB00099900011234', 'CMSBSNDC00044400056789',
    'CMSBSNDA00011100022233',
];

// Tous les codes d'erreur HTTP simulés — champ exc pour extraction Loki ← MODIFIÉ
const ERROR_SCENARIOS = [
    { code: 400, label: 'BAD_REQUEST',           msg: 'Requête invalide.',                   exc: 'BadRequestException',          weight: 15 },
    { code: 404, label: 'NOT_FOUND',             msg: 'Compte introuvable.',                 exc: 'ResourceNotFoundException',    weight: 20 },
    { code: 409, label: 'CONFLICT',              msg: 'Transaction déjà en cours.',          exc: 'ConflictException',            weight: 10 },
    { code: 422, label: 'UNPROCESSABLE_ENTITY',  msg: 'Données de transaction invalides.',   exc: 'ValidationException',         weight: 10 },
    { code: 500, label: 'INTERNAL_SERVER_ERROR', msg: 'Erreur interne du serveur.',          exc: 'InternalServerErrorException', weight: 20 },
    { code: 503, label: 'SERVICE_UNAVAILABLE',   msg: 'Service momentanément indisponible.', exc: 'ServiceUnavailableException',  weight: 25 },
];

function getLogFile() {
    return path.join(LOG_DIR, `addons-wave-${new Date().toISOString().slice(0,10)}.log`);
}
function now()           { return new Date().toISOString(); }
function writeLine(line) { fs.appendFileSync(getLogFile(), line + '\n'); }
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Pool fixe — remplace la génération aléatoire illimitée ← MODIFIÉ
function randomAccount() {
    return FIXED_ACCOUNTS[Math.floor(Math.random() * FIXED_ACCOUNTS.length)];
}

function randomRequestId() {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return 'WAVE_LIAT_sn_' + Array.from({length:12}, () => c[Math.floor(Math.random()*c.length)]).join('');
}

function pickError() {
    const total = ERROR_SCENARIOS.reduce((s,x)=>s+x.weight,0);
    let r = Math.random()*total;
    for (const e of ERROR_SCENARIOS) { r-=e.weight; if(r<=0) return e; }
    return ERROR_SCENARIOS[0];
}

function logLine(ts, level, thread, logger, message, traceId = null) {
    const tid = traceId ? ` [trace_id=${traceId}]` : '';
    writeLine(`${ts}${tid} ${level.padEnd(5)} ${PID} --- [${thread}] ${logger}: ${message}`);
}

// Fonction logError avec ligne résumé combinée ← MODIFIÉ
// La ligne résumé contient HTTP METHOD URL + Response code + Exception
// dans UN seul événement Loki → endpoint ET exception extraits par la même query d'alerte
function logError(thread, err, traceId, method, url) {
    logLine(now(), 'DEBUG', thread, LOGGERS.rest,
        `HTTP ${method} ${url} → Response ${err.code} ${err.label} | Exception : ${err.exc}`, traceId);
    // Lignes détail (format original des vrais logs Wave)
    logLine(now(), 'INFO', thread, LOGGERS.errorHandler,
        `{"status":false,"status_code":"${err.code}","status_message":"${err.msg}"}`, traceId);
    logLine(now(), 'ERROR', thread, LOGGERS.middleware, err.msg, traceId);
}

function generateGetBalance(thread, account) {
    const url     = `${INTERNAL_HOST}/accounts/${account}/balance?origin=WAVE`; // ← NOUVEAU
    const isError = Math.random() < 0.08;
    const { span, traceId } = startSpan(`HTTP GET /accounts/balance`, {
        'service.name': 'addons-wave', 'http.method': 'GET',
        'http.url': `/accounts/${account}/balance`,
    });

    logLine(now(), 'DEBUG', thread, LOGGERS.rest, `HTTP GET ${url}`, traceId);
    logLine(now(), 'DEBUG', thread, LOGGERS.rest,
        `Accept=[application/json, application/*+json]`, traceId);

    setTimeout(() => {
        if (isError) {
            const err = pickError();
            if (err.code >= 500) httpCounters.error500++; else httpCounters.error4xx++;
            logError(thread, err, traceId, 'GET', url); // ← MODIFIÉ — passe method + url
            endSpan(span, err.code);
        } else {
            httpCounters.success++;
            logLine(now(), 'DEBUG', thread, LOGGERS.rest, `Response 200 OK`, traceId);
            logLine(now(), 'DEBUG', thread, LOGGERS.rest,
                `Reading to [${DTO_PKG}.dto.GetBalanceResponse]`, traceId);
            endSpan(span, 200);
        }
    }, 300 + Math.random() * 700);
}

function generatePostTransaction(thread, account) {
    const url       = `${INTERNAL_HOST}/transactions`; // ← NOUVEAU
    const isError   = Math.random() < 0.08;
    const requestId = randomRequestId();
    const nominal   = (Math.floor(Math.random() * 100) + 1) * 50;
    const charge    = Math.floor(nominal * 0.005);

    const { span, traceId } = startSpan(`HTTP POST /transactions`, {
        'service.name': 'addons-wave', 'http.method': 'POST',
        'wave.request_id': requestId, 'wave.nominal': nominal,
    });

    const txBody = `CreateTransactionRequest(requestId=${requestId}, operationName=B2W, ` +
        `amounts=[AmountDto(name=NOMINAL, value=${nominal}, unit=XOF), ` +
        `AmountDto(name=CHARGE, value=${charge}, unit=XOF)], ` +
        `actors=[TransActorDto(actorType=CLIENT, actorId=${account})], ` +
        `transaction=TransactionDto(accountAlias=${account}, origin=WAVE, ` +
        `localRef=null, requestId=${requestId}, remoteRef=${requestId}, ` +
        `amount=0.0, currency=null, direction=null, status=null, content=null, createdAt=null))`;

    logLine(now(), 'DEBUG', thread, LOGGERS.rest, `HTTP POST ${url}`, traceId);
    logLine(now(), 'DEBUG', thread, LOGGERS.rest,
        `Accept=[application/json, application/*+json]`, traceId);
    logLine(now(), 'DEBUG', thread, LOGGERS.rest,
        `Writing [${txBody}] with org.springframework.http.converter.json.MappingJackson2HttpMessageConverter`,
        traceId);

    setTimeout(() => {
        if (isError) {
            const err = pickError();
            if (err.code >= 500) httpCounters.error500++; else httpCounters.error4xx++;
            logError(thread, err, traceId, 'POST', url); // ← MODIFIÉ — passe method + url
            endSpan(span, err.code);
        } else {
            httpCounters.success++;
            logLine(now(), 'DEBUG', thread, LOGGERS.rest, `Response 200 OK`, traceId);
            logLine(now(), 'DEBUG', thread, LOGGERS.rest,
                `Reading to [${DTO_PKG}.dto.CreateTransactionResponse]`, traceId);
            endSpan(span, 200);
        }
    }, 500 + Math.random() * 1500);
}

function generateActivity() {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const thread  = randomFrom(THREADS);
        const account = randomAccount();
        setTimeout(() => {
            if (Math.random() < 0.3) generatePostTransaction(thread, account);
            else generateGetBalance(thread, account);
        }, i * (100 + Math.random() * 200));
    }
}

console.log('🚀 Mock addons-wave (Wave + OTel) démarré →', LOG_DIR);
function scheduleNext() {
    setTimeout(() => { generateActivity(); scheduleNext(); }, 2000 + Math.random() * 2000);
}
scheduleNext();