# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

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

# ---- Serve : nginx SPA + node API ----
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache nginx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/server.cjs ./server.cjs
COPY --from=builder /app/server-auth.cjs ./server-auth.cjs
COPY --from=builder /app/server-email.cjs ./server-email.cjs
COPY --from=builder /app/server-email-core.cjs ./server-email-core.cjs
COPY --from=builder /app/server-email-compose.cjs ./server-email-compose.cjs
COPY --from=builder /app/server-billing.cjs ./server-billing.cjs
COPY --from=builder /app/server-security.cjs ./server-security.cjs
COPY --from=builder /app/server-assistant.cjs ./server-assistant.cjs
COPY --from=builder /app/server-ai-cost.cjs ./server-ai-cost.cjs
COPY --from=builder /app/server-twilio.cjs ./server-twilio.cjs
COPY --from=builder /app/server-insurance.cjs ./server-insurance.cjs
COPY --from=builder /app/server-insurance-mailbox.cjs ./server-insurance-mailbox.cjs
COPY --from=builder /app/server-documents.cjs ./server-documents.cjs
COPY --from=builder /app/server-commerce.cjs ./server-commerce.cjs
COPY --from=builder /app/server-signage.cjs ./server-signage.cjs
COPY assets ./assets
COPY public ./public

RUN npm ci --omit=dev --legacy-peer-deps
RUN ls -la /app/server-*.cjs | wc -l && echo "Server modules check OK"

RUN mkdir -p /etc/nginx/http.d && cat > /etc/nginx/http.d/default.conf << 'NGINXEOF'
server {
    listen __PORT__;
    root /app/dist;
    index index.html;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co https://*.railway.app https://app.base44.com https://api.base44.com wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    if ($host = documents.jsinnovia.com) {
        return 302 https://cockpit.jsinnovia.com/documents;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
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
