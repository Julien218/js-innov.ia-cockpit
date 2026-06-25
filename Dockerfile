# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ---- Serve ----
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Config nginx avec SPA fallback — toutes les routes redirigent vers index.html
RUN printf "server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  # SPA fallback — React Router\n\
  location / {\n\
    try_files \$uri \$uri/ /index.html;\n\
  }\n\
  # Cache assets\n\
  location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {\n\
    expires 1y;\n\
    add_header Cache-Control \"public, immutable\";\n\
  }\n\
  # Gzip\n\
  gzip on;\n\
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml;\n\
}\n" > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

