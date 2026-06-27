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
COPY server.cjs ./server.cjs
# Installer uniquement express en prod
RUN npm install --omit=dev --legacy-peer-deps
EXPOSE 3000
CMD ["node", "server.cjs"]

