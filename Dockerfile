# syntax=docker/dockerfile:1

# ---- Build ----
FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

# Variables publiques uniquement, intégrées au bundle Vite.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_APP_ID
ARG VITE_COCKPIT_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_APP_ID=$VITE_APP_ID \
    VITE_COCKPIT_API_URL=$VITE_COCKPIT_API_URL

RUN npm run build

# ---- Runtime : nginx SPA + API Node ----
FROM node:24-alpine
WORKDIR /app

RUN apk add --no-cache nginx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/server.cjs ./server.cjs
COPY --from=builder /app/server-auth.cjs ./server-auth.cjs
COPY --from=builder /app/server-email.cjs ./server-email.cjs
COPY --from=builder /app/server-billing.cjs ./server-billing.cjs
COPY --from=builder /app/server-security.cjs ./server-security.cjs
COPY --from=builder /app/server-assistant.cjs ./server-assistant.cjs
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY --from=builder /app/deploy/start.sh /app/start.sh

RUN npm ci --omit=dev --legacy-peer-deps \
    && chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]
