# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ---- Serve ----
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY server.cjs ./server.cjs
RUN npm install express --save-prod
EXPOSE 3000
CMD ["node", "server.cjs"]

