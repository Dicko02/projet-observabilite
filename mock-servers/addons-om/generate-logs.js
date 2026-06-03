/*
  Mock addons-om — Spring Boot, Orange Money (port 8888)
  Format : TIMESTAMP [trace_id=xxx] LEVEL PID --- [thread] logger : message
  OTel activé — simule l'état après déploiement de l'OTel Java Agent
  TRACE pour SOAP in/out, DEBUG pour RestTemplate, ERROR sur erreurs backend
*/

const fs   = require('fs');
const path = require('path');
const { initTracing, startSpan, endSpan } = require('../otel-tracing');
const http = require('http');

const LOG_DIR = '/logs/addons-om';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const httpCounters = { success: 0, error500: 0 };

const metricsServer = http.createServer((req, res) => {
    if (req.url === '/actuator/prometheus') {
        const uptime = process.uptime();
        const mem    = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end([
            `# HELP jvm_memory_used_bytes Simulated JVM memory`,
            `# TYPE jvm_memory_used_bytes gauge`,
            `jvm_memory_used_bytes{area="heap"} ${mem.heapUsed}`,
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

initTracing('addons-om');

const PID     = '2484997';
const PORT    = '8888';
const THREADS = Array.from({ length: 10 }, (_, i) => `http-nio-${PORT}-exec-${i + 1}`);
const DTO_PKG = 'sn.cms.ao';

// Loggers observés dans les vrais logs de addons-om
const LOGGERS = {
    received:     'o.s.ws.server.MessageTracing.received ',
    sent:         'o.s.ws.server.MessageTracing.sent     ',
    rest:         'o.s.web.client.RestTemplate           ',
    errorHandler: 's.c.a.e.RestTemplateErrorHandler     ',
    middleware:   `${DTO_PKG}.services.MiddlewareService  `,
};

// Deux opérations SOAP observées dans les vrais logs
const SOAP_OPERATIONS = [
    {
        name:      'GetAccountBalance',
        reqType:   'GETACCBAL',
        nsType:    'GetAccountBalance',
        resType:   'GetAccountBalanceResponse',
        path:      (account) => `/accounts/${account}/balance?origin=OFMS`,
        httpMethod:'GET',
        dto:       'GetBalanceResponse',
    },
    {
        name:      'GetMiniStatement',
        reqType:   'GETMINI',
        nsType:    'GetMiniStatement',
        resType:   'GetMiniStatementResponse',
        path:      (account) => `/accounts/${account}/transactions`,
        httpMethod:'GET',
        dto:       'GetMiniStatementResponse',
    },
];

// Pool FIXE de comptes — évite l'explosion de séries uniques dans topk du dashboard ← MODIFIÉ
const FIXED_ACCOUNTS = [
    'CMSBSNDA00000101586066', 'CMSBSNDA00042600026650', 'CMSBSNDA00030800029169',
    'CMSBSNDB00021300087654', 'CMSBSNDC00044400056789', 'CMSBSNDA00011100022233',
    'CMSBSNDB00099900011234', 'CMSBSNDA00050100073014',
];

const OPERATOR_CODES = ['ORANGEMONEYSN'];
const AFFILIATE_CODES = ['OSN'];
const INTERNAL_HOST   = 'http://192.168.122.115:9999';

// Scénarios d'erreur — champ exc pour extraction Loki dans la ligne résumé ← MODIFIÉ
const ERROR_SCENARIOS = [
    { code: 400, label: 'BAD_REQUEST',           msg: 'Requête invalide.',                   exc: 'BadRequestException',          weight: 15 },
    { code: 404, label: 'NOT_FOUND',             msg: 'Compte introuvable.',                 exc: 'ResourceNotFoundException',    weight: 20 },
    { code: 500, label: 'INTERNAL_SERVER_ERROR', msg: 'Erreur interne du serveur.',          exc: 'InternalServerErrorException', weight: 35 },
    { code: 503, label: 'SERVICE_UNAVAILABLE',   msg: 'Nous rencontrons un souci technique.',exc: 'ServiceUnavailableException',  weight: 30 },
];

function getLogFile() {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `addons-om-${date}.log`);
}

function now()           { return new Date().toISOString(); }
function writeLine(line) { fs.appendFileSync(getLogFile(), line + '\n'); }
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Pool fixe — remplace la génération aléatoire illimitée ← MODIFIÉ
function randomAccount() {
    return FIXED_ACCOUNTS[Math.floor(Math.random() * FIXED_ACCOUNTS.length)];
}

function randomRequestId() {
    const d      = new Date();
    const date   = String(d.getFullYear()).slice(2) +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0');
    const alpha  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const suffix = Array.from({ length: 6 }, () =>
        alpha[Math.floor(Math.random() * alpha.length)]).join('');
    return `OR${date}${suffix}`;
}

function pickError() {
    const total = ERROR_SCENARIOS.reduce((s,x)=>s+x.weight,0);
    let r = Math.random()*total;
    for (const e of ERROR_SCENARIOS) { r-=e.weight; if(r<=0) return e; }
    return ERROR_SCENARIOS[0];
}

// Format avec trace_id — le parser logback capture [trace_id=xxx] optionnel avant le level
function logLine(ts, level, thread, logger, message, traceId = null) {
    const tidPart = traceId ? ` [trace_id=${traceId}]` : '';
    writeLine(`${ts}${tidPart} ${level.padEnd(5)} ${PID} --- [${thread}] ${logger}: ${message}`);
}

// Fonction logError avec ligne résumé combinée ← NOUVEAU
// La ligne résumé contient HTTP METHOD URL + Response code + Exception
// dans UN seul événement Loki → endpoint ET exception extraits par la même query d'alerte
function logError(thread, err, traceId, method, url) {
    logLine(now(), 'DEBUG', thread, LOGGERS.rest,
        `HTTP ${method} ${url} → Response ${err.code} ${err.label} | Exception : ${err.exc}`, traceId);
    logLine(now(), 'INFO', thread, LOGGERS.errorHandler,
        `{"status":false,"status_code":"${err.code}","status_message":"${err.msg}"}`, traceId);
    logLine(now(), 'ERROR', thread, LOGGERS.middleware, err.msg, traceId);
}

function buildSoapRequest(op, requestId, account, opCode, affCode) {
    return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
        `<soap:Body><ns2:${op.nsType} xmlns:ns2="http://b2w.banktowallet.com/b2w">` +
        `<${op.nsType}Request><mmHeaderInfo>` +
        `<operatorCode>${opCode}</operatorCode>` +
        `<requestId>${requestId}</requestId>` +
        `<requestToken/><requestType>${op.reqType}</requestType>` +
        `<affiliateCode>${affCode}</affiliateCode>` +
        `</mmHeaderInfo><accountNo/>` +
        `<accountAlias>${account}</accountAlias>` +
        `<reason/></${op.nsType}Request>` +
        `</ns2:${op.nsType}></soap:Body></soap:Envelope>`;
}

function buildSoapResponseOK(op, requestId, account, opCode, affCode, balance) {
    return `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">` +
        `<SOAP-ENV:Header/><SOAP-ENV:Body>` +
        `<ns3:${op.resType} xmlns:ns3="http://b2w.banktowallet.com/b2w">` +
        `<return><mmHeaderInfo>` +
        `<operatorCode>${opCode}</operatorCode><requestId>${requestId}</requestId>` +
        `<affiliateCode>${affCode}</affiliateCode>` +
        `<responseCode>000</responseCode><responseMessage>success</responseMessage>` +
        `</mmHeaderInfo>` +
        `<accountAlias>${account}</accountAlias><ccy>XOF</ccy>` +
        `<availableBalance>${balance}</availableBalance>` +
        `<currentBalance>${balance}</currentBalance>` +
        `</return></ns3:${op.resType}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

function buildSoapResponseError(op, requestId, opCode, affCode) {
    return `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">` +
        `<SOAP-ENV:Header/><SOAP-ENV:Body>` +
        `<ns3:${op.resType} xmlns:ns3="http://b2w.banktowallet.com/b2w">` +
        `<return><mmHeaderInfo>` +
        `<operatorCode>${opCode}</operatorCode><requestId>${requestId}</requestId>` +
        `<affiliateCode>${affCode}</affiliateCode>` +
        `<responseCode>E09</responseCode>` +
        `<responseMessage>Nous rencontrons un souci technique</responseMessage>` +
        `</mmHeaderInfo></return></ns3:${op.resType}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

function generateTransaction() {
    const op        = randomFrom(SOAP_OPERATIONS);
    const thread    = randomFrom(THREADS);
    const account   = randomAccount();
    const requestId = randomRequestId();
    const opCode    = randomFrom(OPERATOR_CODES);
    const affCode   = randomFrom(AFFILIATE_CODES);
    const isError   = Math.random() < 0.08;
    // errCode déterminé UNE SEULE FOIS avant le setTimeout ← CORRECTION bug double pickError
    const errCode   = isError ? pickError() : null;
    const balance   = (Math.random() * 200000 - 50000).toFixed(1);

    if (isError) httpCounters.error500++;
    else httpCounters.success++;

    const { span, traceId } = startSpan(`SOAP ${op.name}`, {
        'service.name':   'addons-om',
        'soap.operation': op.name,
    });

    const t1 = now();

    logLine(t1, 'TRACE', thread, LOGGERS.received,
        `Received request [${buildSoapRequest(op, requestId, account, opCode, affCode)}]`,
        traceId);

    const internalPath = op.path(account);
    const internalUrl  = `${INTERNAL_HOST}${internalPath}`; // ← NOUVEAU — URL capturée pour logError

    logLine(now(), 'DEBUG', thread, LOGGERS.rest,
        `HTTP ${op.httpMethod} ${internalUrl}`, traceId);
    logLine(now(), 'DEBUG', thread, LOGGERS.rest,
        `Accept=[application/json, application/*+json]`, traceId);

    setTimeout(() => {
        const t2 = now();

        if (isError) {
            // Utilise errCode (choisi avant le setTimeout) — pas de double pickError ← CORRECTION
            logError(thread, errCode, traceId, op.httpMethod, internalUrl); // ← MODIFIÉ
            logLine(now(), 'TRACE', thread, LOGGERS.sent,
                `Sent response [${buildSoapResponseError(op, requestId, opCode, affCode)}] ` +
                `for request [${buildSoapRequest(op, requestId, account, opCode, affCode)}]`,
                traceId);
        } else {
            logLine(t2, 'DEBUG', thread, LOGGERS.rest, `Response 200 OK`, traceId);
            logLine(t2, 'DEBUG', thread, LOGGERS.rest,
                `Reading to [${DTO_PKG}.dto.${op.dto}]`, traceId);
            logLine(now(), 'TRACE', thread, LOGGERS.sent,
                `Sent response [${buildSoapResponseOK(op, requestId, account, opCode, affCode, balance)}] ` +
                `for request [${buildSoapRequest(op, requestId, account, opCode, affCode)}]`,
                traceId);
        }

        // UN SEUL endSpan — correction du bug de double appel ← CORRECTION
        endSpan(span, isError ? errCode.code : 200);
    }, 200 + Math.random() * 800);
}

console.log('🚀 Mock addons-om (Orange Money / SOAP + OTel) démarré →', LOG_DIR);

function scheduleNext() {
    setTimeout(() => {
        generateTransaction();
        scheduleNext();
    }, 3000 + Math.random() * 2000);
}

scheduleNext();