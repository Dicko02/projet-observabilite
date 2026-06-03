FROM node:22-alpine

WORKDIR /app

# Fichiers partagés — copiés depuis la racine du contexte (mock-servers/)
COPY package.json ./
COPY otel-tracing.js ./
RUN npm install

# Fichier spécifique au service — copié dans /app/service/
# pour que require('../otel-tracing') fonctionne identiquement
# dans le container ET sur la machine hôte
ARG SERVICE_DIR
COPY ${SERVICE_DIR}/generate-logs.js ./service/

CMD ["node", "service/generate-logs.js"]