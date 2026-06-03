/*
  Mock backoffice — PHP/Laravel
  Format : [YYYY-MM-DD HH:MM:SS] production.LEVEL: message
  Pas d'OTel (PHP natif), pas d'Actuator (pas Spring Boot)
  Chaque ligne = un événement Fluent Bit distinct (parser backoffice-laravel)
*/

const fs   = require('fs');
const path = require('path');
const http = require('http'); // ← NOUVEAU

// ── Endpoint de santé — Blackbox Exporter probe /health ────────────────────── ← NOUVEAU
// Simule la route Laravel /health que le vrai backoffice exposera en production
const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"status":"UP"}');
    } else { res.writeHead(404); res.end(); }
});
healthServer.listen(8080, () => console.log('Health check sur :8080/health')); // ← NOUVEAU

const LOG_DIR = '/logs/backoffice';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `backoffice-${date}.log`);
}

function timestamp() {
    return new Date().toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');
}

function writeLine(line) {
    fs.appendFileSync(getLogFile(), line + '\n');
}

function logLine(level, message) {
    writeLine(`[${timestamp()}] production.${level}: ${message}`);
}

// ── Données de simulation ─────────────────────────────────────────────────────

const USERS = [
    'Ibrahima Tacko Diarra (ibrahima@cms.sn)',
    'OULIMATA NIANG (oulimata@cms.sn)',
    'AMINATA BA (aminata@cms.sn)',
    'Mamadou Diallo (mamadou@cms.sn)',
    'Fatou Sow (fatou@cms.sn)',
    'Moussa Diop (moussa@cms.sn)',
    'Aissatou Camara (aissatou@cms.sn)',
];

const ENDPOINTS = [
    { method: 'GET',  path: '/reclamation/reclamations'      },
    { method: 'GET',  path: '/reclamation/reclamations/3090' },
    { method: 'GET',  path: '/mobile/entree_en_relation'     },
    { method: 'GET',  path: '/mobile/souscriptions/create'   },
    { method: 'POST', path: '/mobile/souscriptions/search'   },
    { method: 'GET',  path: '/mobile/transactions'           },
    { method: 'GET',  path: '/dashboard'                     },
    { method: 'GET',  path: '/mobile/comptes'                },
    { method: 'POST', path: '/mobile/recharge'               },
    { method: 'GET',  path: '/administration/utilisateurs'   },
    { method: 'GET',  path: '/rapports/journalier'           },
    { method: 'POST', path: '/mobile/virements'              },
];

const STATUS_WEIGHTS = [
    { code: 200, weight: 74 },
    { code: 201, weight: 10 },
    { code: 400, weight: 5  },
    { code: 401, weight: 3  },
    { code: 403, weight: 2  },
    { code: 404, weight: 2  },
    { code: 422, weight: 1  },
    { code: 500, weight: 2  },
    { code: 503, weight: 1  },
];

const PAYLOADS_POST = {
    '/mobile/souscriptions/search': () => JSON.stringify({ data: {
        customer_code: String(Math.floor(Math.random() * 9000) + 1000),
        phonenumber:   '77' + String(Math.floor(Math.random() * 9000000) + 1000000),
    }}),
    '/mobile/recharge': () => JSON.stringify({ data: {
        amount: Math.floor(Math.random() * 50000) + 1000,
        phone:  '7' + String(Math.floor(Math.random() * 90000000) + 10000000),
    }}),
    '/mobile/virements': () => JSON.stringify({ data: {
        amount:    Math.floor(Math.random() * 100000) + 5000,
        reference: 'VIR' + Date.now(),
    }}),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function weightedStatus() {
    const total = STATUS_WEIGHTS.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    for (const s of STATUS_WEIGHTS) { r -= s.weight; if (r <= 0) return s.code; }
    return 200;
}

function getPayload(method, ep) {
    if (method === 'GET') return JSON.stringify({ data: [] });
    const fn = PAYLOADS_POST[ep];
    return fn ? fn() : JSON.stringify({ data: {} });
}

function statusToLevel(code) {
    if (code >= 500) return 'ERROR';
    if (code >= 400) return 'WARNING';
    return 'INFO';
}

// ── Générateur de requêtes ────────────────────────────────────────────────────

function generateRequest() {
    const user    = randomFrom(USERS);
    const ep      = randomFrom(ENDPOINTS);
    const status  = weightedStatus();
    const level   = statusToLevel(status);
    const url     = `https://backoffice.cms.sn${ep.path}`;
    const payload = getPayload(ep.method, ep.path);

    logLine('INFO', `-----------------------------------------------------------------------`);
    logLine('INFO', `Utilisateur: ${user}`);
    logLine('INFO', `Requête: ${url}`);
    logLine('INFO', `Méthode: ${ep.method}`);
    logLine('INFO', `Payload:  ${payload}`);
    logLine(level,  `Statut réponse: ${status}`);
    logLine('INFO', `-----------------------------------------------------------------------`);
}

// ── Démarrage ─────────────────────────────────────────────────────────────────

console.log('🚀 Mock backoffice (Laravel) démarré →', LOG_DIR);

function scheduleNext() {
    setTimeout(() => {
        generateRequest();
        scheduleNext();
    }, 2000 + Math.random() * 3000);
}

scheduleNext();