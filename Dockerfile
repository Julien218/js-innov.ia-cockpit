# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ---- Serve : nginx SPA + node API email ----
# On utilise deux services dans le même conteneur via un script supervisor
FROM node:20-alpine
WORKDIR /app

# Installer nginx
RUN apk add --no-cache nginx

# Copier le dist depuis le build
COPY --from=builder /app/dist ./dist

# Copier les fichiers serveur email
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY server.cjs ./server.cjs
COPY server-email.cjs ./server-email.cjs

# Installer les dépendances prod (imap, mailparser, express)
RUN npm ci --omit=dev --legacy-peer-deps

# Config nginx — SPA fallback + proxy /api vers Express :3001
RUN mkdir -p /etc/nginx/http.d && cat > /etc/nginx/http.d/default.conf << 'EOF'
server {
    listen 3000;
    root /app/dist;
    index index.html;

    # Proxy les routes API vers Express
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback — React Router
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Script de démarrage : lance Express (API) + nginx (SPA)
RUN cat > /app/start.sh << 'EOF'
#!/bin/sh
# Lance Express sur :3001 (API emails uniquement)
node /app/server.cjs &
# Lance nginx sur :3000 (SPA + proxy API)
nginx -g "daemon off;"
EOF
RUN chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]
