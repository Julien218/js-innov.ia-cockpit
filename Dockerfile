# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

# VITE_BASE44_API_KEY removed — key is server-side only.
ARG VITE_AGENT_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_AGENT_URL=$VITE_AGENT_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN test -f server-task-context.cjs \
 && test -f server-nova-document-preload.cjs \
 && test -f server-nova-document-upload.cjs \
 && test -f server-supplier-invoice.cjs \
 && node --check server-task-context.cjs \
 && node --check server-nova-document-preload.cjs \
 && node --check server-nova-document-upload.cjs \
 && node --check server-supplier-invoice.cjs \
 && node --test tests/supplier-invoice-server.test.cjs tests/email-accounting-currency.test.cjs
RUN npm run build

# ---- Serve : nginx SPA + node API ----
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache nginx ffmpeg

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
# Tous les modules serveur racine sont copiés. Cela empêche qu'un nouveau module
# présent dans Git mais oublié dans une liste manuelle casse le runtime Railway.
COPY --from=builder /app/*.cjs ./
COPY --from=builder /app/*.json ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/public ./public

RUN npm ci --omit=dev --legacy-peer-deps
RUN test -f /app/server.cjs \
 && test -f /app/server-task-context.cjs \
 && test -f /app/server-assistant-batch.cjs \
 && test -f /app/server-specialist-tasks.cjs \
 && test -f /app/server-nova-document-preload.cjs \
 && test -f /app/server-nova-document-upload.cjs \
 && test -f /app/server-supplier-invoice.cjs \
 && node --check /app/server.cjs \
 && node --check /app/server-task-context.cjs \
 && node --check /app/server-assistant-batch.cjs \
 && node --check /app/server-specialist-tasks.cjs \
 && node --check /app/server-nova-document-preload.cjs \
 && node --check /app/server-nova-document-upload.cjs \
 && node --check /app/server-supplier-invoice.cjs \
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

RUN printf '#!/bin/sh\nsed -i "s/__PORT__/${PORT:-3000}/" /etc/nginx/http.d/default.conf\nnode -r /app/server-nova-document-preload.cjs /app/server.cjs &\nnginx -g "daemon off;"\n' > /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]
