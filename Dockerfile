# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
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
COPY --from=builder /app/server.cjs ./server.cjs
# Keep the runtime complete when a new backend module is added. server.cjs is
# copied separately because the wildcard intentionally targets server-*.cjs.
COPY --from=builder /app/server-*.cjs ./
COPY --from=builder /app/migrations ./migrations
COPY assets ./assets
COPY public ./public

RUN npm ci --omit=dev --legacy-peer-deps
RUN test -f /app/server-billing-template.cjs && test -f /app/server-cost-centers.cjs && echo "Server modules check OK"

RUN mkdir -p /etc/nginx/http.d && cat > /etc/nginx/http.d/default.conf << 'NGINXEOF'
server {
    listen __PORT__;
    root /app/dist;
    index index.html;
    client_max_body_size 150m;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: https://*.dropboxusercontent.com https://*.dropbox.com; connect-src 'self' http://127.0.0.1:8787 http://localhost:8787 https://*.supabase.co https://*.railway.app https://app.base44.com https://api.base44.com wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    if ($host = documents.jsinnovia.com) {
        return 302 https://cockpit.jsinnovia.com/documents;
    }

    # Short, stable TVBOX download URLs. The Node route selects the latest
    # signed release and keeps the legacy APK only as a temporary fallback.
    location = /player {
        return 302 /api/player-download/android;
    }

    location = /player.apk {
        return 302 /api/player-download/android;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
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
