# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

# Variables VITE_ baked au build — passées via ARG depuis Railway build-time env
ARG VITE_AGENT_KEY
ARG VITE_AGENT_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_BASE44_API_KEY
ENV VITE_AGENT_KEY=$VITE_AGENT_KEY
ENV VITE_AGENT_URL=$VITE_AGENT_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_BASE44_API_KEY=$VITE_BASE44_API_KEY

RUN npm run build

# ---- Serve : nginx SPA + node API email ----
FROM node:20-alpine
WORKDIR /app

# Installer nginx
RUN apk add --no-cache nginx

# Copier le dist depuis le build
COPY --from=builder /app/dist ./dist

# Copier les fichiers serveur
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY server.cjs ./server.cjs
COPY server-auth.cjs ./server-auth.cjs
COPY server-email.cjs ./server-email.cjs
COPY server-billing.cjs ./server-billing.cjs
COPY server-security.cjs ./server-security.cjs
COPY server-assistant.cjs ./server-assistant.cjs
COPY server-email-core.cjs ./server-email-core.cjs
COPY assets ./assets

# Installer les dépendances prod (imap, mailparser, express, cookie, assistant)
RUN npm ci --omit=dev --legacy-peer-deps

# Config nginx — SPA fallback + proxy /api vers Express :3001 + headers sécurité
RUN mkdir -p /etc/nginx/http.d && cat > /etc/nginx/http.d/default.conf << 'NGINXEOF'
server {
    listen 3000;
    root /app/dist;
    index index.html;

    # Headers de sécurité
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co https://*.railway.app https://app.base44.com https://api.base44.com wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # Proxy les routes API vers Express
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA fallback — React Router
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF

# Script de démarrage : lance Express (API) + nginx (SPA)
RUN printf '#!/bin/sh\nnode /app/server.cjs &\nnginx -g "daemon off;"\n' > /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]
