# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ---- Serve (node + express SPA) ----
FROM node:20-alpine
WORKDIR /app
# Copier dist et les fichiers nécessaires
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY server.cjs ./server.cjs
COPY server-email.cjs ./server-email.cjs
# Installer toutes les dépendances prod (imap, mailparser, express)
RUN npm ci --omit=dev --legacy-peer-deps
EXPOSE 3000
CMD ["node", "server.cjs"]
