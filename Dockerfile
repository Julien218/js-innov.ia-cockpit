# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

# VITE_BASE44_API_KEY removed — key is now BASE44_API_KEY (server-side only)
ARG VITE_AGENT_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_AGENT_URL=$VITE_AGENT_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ---- Serve : nginx SPA + node API ----
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache nginx ffmpeg

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

# Tous les modules serveur CommonJS sont embarqués. Cela évite qu'un nouveau
# module métier fonctionne en CI mais disparaisse de l'image Railway.
COPY --from=builder /app/server*.cjs ./
COPY --from=builder /app/monthly-billing-runner.cjs ./monthly-billing-runner.cjs
COPY --from=builder /app/permission-catalog.json ./permission-catalog.json
COPY --from=builder /app/demande-status.json ./demande-status.json
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/public ./public

RUN npm ci --omit=dev --legacy-peer-deps
RUN test -f /app/server.cjs \
 && test -f /app/server-billing.cjs \
 && test -f /app/server-monthly-billing.cjs \
 && test -f /app/monthly-billing-runner.cjs \
 && test -f /app/server-client-costs.cjs \
 && test -f /app/server-ai-cost-ledger-aggregate.cjs \
 && test -f /app/server-cost-accounting-core.cjs \
 && test -f /app/server-provider-cost-imports.cjs \
 && test -f /app/server-documents.cjs \
 && node --check /app/server.cjs \
 && node --check /app/server-billing.cjs \
 && node --check /app/server-monthly-billing.cjs \
 && node --check /app/monthly-billing-runner.cjs \
 && node --check /app/server-client-costs.cjs \
 && node --check /app/server-ai-cost-ledger-aggregate.cjs \
 && node --check /app/server-cost-accounting-core.cjs \
 && node --check /app/server-provider-cost-imports.cjs \
 && node -e "JSON.parse(require('node:fs').readFileSync('/app/permission-catalog.json','utf8'))" \
 && echo "Required runtime modules check OK"

RUN mkdir -p /etc/nginx/http.d && cat > /etc/nginx/http.d/default.conf << 'NGINXEOF'
server {
    listen __PORT__;
    root /app/dist;
    index index.html;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co https://*.railway.app https://app.base44.com https://api.base44.com wss://*.supabase.co http://127.0.0.1:8787 http://localhost:8787 http://127.0.0.1:8788 http://localhost:8788 http://127.0.0.1:8791 http://localhost:8791 http://127.0.0.1:8792 http://localhost:8792 http://127.0.0.1:8793 http://localhost:8793; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    client_max_body_size 260m;

    if ($host = documents.jsinnovia.com) {
        return 302 https://cockpit.jsinnovia.com/documents;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_request_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF

RUN printf '#!/bin/sh\nsed -i "s/__PORT__/${PORT:-3000}/" /etc/nginx/http.d/default.conf\nnode /app/server.cjs &\nnginx -g "daemon off;"\n' > /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]
