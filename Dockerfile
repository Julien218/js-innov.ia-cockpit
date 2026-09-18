# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

# VITE_BASE44_API_KEY removed — key is now BASE44_API_KEY (server-side only)
ARG VITE_AGENT_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_AGENT_URL=$VITE_AGENT_URL
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
COPY --from=builder /app/server-auth.cjs ./server-auth.cjs
COPY --from=builder /app/server-email.cjs ./server-email.cjs
COPY --from=builder /app/server-email-action-recovery.cjs ./server-email-action-recovery.cjs
COPY --from=builder /app/server-email-presentation.cjs ./server-email-presentation.cjs
COPY --from=builder /app/server-email-trash-core.cjs ./server-email-trash-core.cjs
COPY --from=builder /app/server-email-branding.cjs ./server-email-branding.cjs
COPY --from=builder /app/server-email-core.cjs ./server-email-core.cjs
COPY --from=builder /app/server-email-compose.cjs ./server-email-compose.cjs
COPY --from=builder /app/server-email-accounting-core.cjs ./server-email-accounting-core.cjs
COPY --from=builder /app/server-email-accounting.cjs ./server-email-accounting.cjs
COPY --from=builder /app/server-google-mail-core.cjs ./server-google-mail-core.cjs
COPY --from=builder /app/server-google-mail.cjs ./server-google-mail.cjs
COPY --from=builder /app/server-billing.cjs ./server-billing.cjs
COPY --from=builder /app/server-billing-template.cjs ./server-billing-template.cjs
COPY --from=builder /app/server-security.cjs ./server-security.cjs
COPY --from=builder /app/server-role-policy.cjs ./server-role-policy.cjs
COPY --from=builder /app/server-permission-policy.cjs ./server-permission-policy.cjs
COPY --from=builder /app/permission-catalog.json ./permission-catalog.json
COPY --from=builder /app/server-client-onboarding.cjs ./server-client-onboarding.cjs
COPY --from=builder /app/server-user-access.cjs ./server-user-access.cjs
COPY --from=builder /app/server-tenant.cjs ./server-tenant.cjs
COPY --from=builder /app/server-data-proxy.cjs ./server-data-proxy.cjs
COPY --from=builder /app/server-demande-status.cjs ./server-demande-status.cjs
COPY --from=builder /app/demande-status.json ./demande-status.json
COPY --from=builder /app/server-client-invoices.cjs ./server-client-invoices.cjs
COPY --from=builder /app/server-project-data.cjs ./server-project-data.cjs
COPY --from=builder /app/server-miss-dour-data.cjs ./server-miss-dour-data.cjs
COPY --from=builder /app/server-bce.cjs ./server-bce.cjs
COPY --from=builder /app/server-hainoflow.cjs ./server-hainoflow.cjs
COPY --from=builder /app/server-assistant.cjs ./server-assistant.cjs
COPY --from=builder /app/server-public-elynea.cjs ./server-public-elynea.cjs
COPY --from=builder /app/server-assistant-batch.cjs ./server-assistant-batch.cjs
COPY --from=builder /app/server-task-batch.cjs ./server-task-batch.cjs
COPY --from=builder /app/server-task-context.cjs ./server-task-context.cjs
COPY --from=builder /app/server-nova-executors.cjs ./server-nova-executors.cjs
COPY --from=builder /app/server-nova-video-direct.cjs ./server-nova-video-direct.cjs
COPY --from=builder /app/server-immediate-execution-policy.cjs ./server-immediate-execution-policy.cjs
COPY --from=builder /app/server-task-autopilot.cjs ./server-task-autopilot.cjs
COPY --from=builder /app/server-companion-audience.cjs ./server-companion-audience.cjs
COPY --from=builder /app/server-companion-memory.cjs ./server-companion-memory.cjs
COPY --from=builder /app/server-agent-registry.cjs ./server-agent-registry.cjs
COPY --from=builder /app/server-led-ad-director.cjs ./server-led-ad-director.cjs
COPY --from=builder /app/server-agent-orchestrator.cjs ./server-agent-orchestrator.cjs
COPY --from=builder /app/server-agent-orchestrator-resilient.cjs ./server-agent-orchestrator-resilient.cjs
COPY --from=builder /app/server-agent-run-log.cjs ./server-agent-run-log.cjs
COPY --from=builder /app/server-domain-ops.cjs ./server-domain-ops.cjs
COPY --from=builder /app/server-ionos-dns.cjs ./server-ionos-dns.cjs
COPY --from=builder /app/server-ionos.cjs ./server-ionos.cjs
COPY --from=builder /app/server-ionos-connector.cjs ./server-ionos-connector.cjs
COPY --from=builder /app/ionos-read-tools.json ./ionos-read-tools.json
COPY --from=builder /app/server-settings.cjs ./server-settings.cjs
COPY --from=builder /app/server-social-command.cjs ./server-social-command.cjs
COPY --from=builder /app/server-signage.cjs ./server-signage.cjs
COPY --from=builder /app/server-villeconnect.cjs ./server-villeconnect.cjs
COPY --from=builder /app/server-video-provenance-core.cjs ./server-video-provenance-core.cjs
COPY --from=builder /app/server-video-provenance.cjs ./server-video-provenance.cjs
COPY --from=builder /app/server-video-studio.cjs ./server-video-studio.cjs
COPY --from=builder /app/server-video-generation-core.cjs ./server-video-generation-core.cjs
COPY --from=builder /app/server-video-generation.cjs ./server-video-generation.cjs
COPY --from=builder /app/server-music-motion.cjs ./server-music-motion.cjs
COPY --from=builder /app/server-audio-library.cjs ./server-audio-library.cjs
COPY --from=builder /app/local-agent/music-motion-engine.mjs ./local-agent/music-motion-engine.mjs
COPY --from=builder /app/server-dropbox-helper.cjs ./server-dropbox-helper.cjs
COPY --from=builder /app/server-ai-cost.cjs ./server-ai-cost.cjs
COPY --from=builder /app/server-nova-routing.cjs ./server-nova-routing.cjs
COPY --from=builder /app/server-ai-cost-attribution.cjs ./server-ai-cost-attribution.cjs
COPY --from=builder /app/server-ai-cost-ledger-aggregate.cjs ./server-ai-cost-ledger-aggregate.cjs
COPY --from=builder /app/server-cost-centers.cjs ./server-cost-centers.cjs
COPY --from=builder /app/server-client-costs.cjs ./server-client-costs.cjs
COPY --from=builder /app/server-openai-cost-diagnostic.cjs ./server-openai-cost-diagnostic.cjs
COPY --from=builder /app/server-cost-accounting-core.cjs ./server-cost-accounting-core.cjs
COPY --from=builder /app/server-provider-cost-imports.cjs ./server-provider-cost-imports.cjs
COPY --from=builder /app/server-twilio.cjs ./server-twilio.cjs
COPY --from=builder /app/server-insurance.cjs ./server-insurance.cjs
COPY --from=builder /app/server-insurance-mailbox.cjs ./server-insurance-mailbox.cjs
COPY --from=builder /app/server-documents.cjs ./server-documents.cjs
COPY --from=builder /app/server-governance.cjs ./server-governance.cjs
COPY --from=builder /app/lib/governance-export.cjs ./lib/governance-export.cjs
COPY --from=builder /app/server-base44-agents.cjs ./server-base44-agents.cjs
COPY --from=builder /app/server-specialist-tasks.cjs ./server-specialist-tasks.cjs
COPY --from=builder /app/server-assistant-intent.cjs ./server-assistant-intent.cjs
COPY --from=builder /app/server-nova-email-triage.cjs ./server-nova-email-triage.cjs
COPY --from=builder /app/server-nova-document-delete.cjs ./server-nova-document-delete.cjs
COPY --from=builder /app/server-push.cjs ./server-push.cjs
COPY assets ./assets
COPY public ./public

RUN npm ci --omit=dev --legacy-peer-deps
RUN test -f /app/server-ai-cost-attribution.cjs \
 && test -f /app/server-email-action-recovery.cjs \
 && test -f /app/server-email-trash-core.cjs \
 && test -f /app/server-role-policy.cjs \
 && test -f /app/server-permission-policy.cjs \
 && test -f /app/server-email-accounting-core.cjs \
 && test -f /app/server-email-accounting.cjs \
 && test -f /app/server-google-mail-core.cjs \
 && test -f /app/server-google-mail.cjs \
 && test -f /app/permission-catalog.json \
 && test -f /app/server-client-onboarding.cjs \
 && test -f /app/server-user-access.cjs \
 && test -f /app/server-project-data.cjs \
 && test -f /app/server-nova-routing.cjs \
 && test -f /app/server-ai-cost-ledger-aggregate.cjs \
 && test -f /app/server-cost-centers.cjs \
 && test -f /app/server-client-costs.cjs \
 && test -f /app/server-openai-cost-diagnostic.cjs \
 && test -f /app/server-cost-accounting-core.cjs \
 && test -f /app/server-provider-cost-imports.cjs \
 && test -f /app/server-agent-registry.cjs \
 && test -f /app/server-led-ad-director.cjs \
 && test -f /app/server-agent-orchestrator.cjs \
 && test -f /app/server-agent-orchestrator-resilient.cjs \
 && test -f /app/server-agent-run-log.cjs \
 && test -f /app/server-domain-ops.cjs \
 && test -f /app/server-ionos-dns.cjs \
 && test -f /app/server-settings.cjs \
 && test -f /app/server-social-command.cjs \
 && test -f /app/server-signage.cjs \
 && test -f /app/server-villeconnect.cjs \
 && test -f /app/server-video-provenance-core.cjs \
 && test -f /app/server-video-provenance.cjs \
 && test -f /app/server-video-studio.cjs \
 && test -f /app/server-video-generation-core.cjs \
 && test -f /app/server-video-generation.cjs \
 && test -f /app/server-audio-library.cjs \
 && test -f /app/server-assistant-batch.cjs \
 && test -f /app/server-task-batch.cjs \
 && test -f /app/server-task-context.cjs \
 && test -f /app/server-nova-executors.cjs \
 && test -f /app/server-nova-video-direct.cjs \
 && test -f /app/server-immediate-execution-policy.cjs \
 && test -f /app/server-task-autopilot.cjs \
 && test -f /app/server-bce.cjs \
 && test -f /app/server-public-elynea.cjs \
 && test -f /app/lib/governance-export.cjs \
 && node --check /app/server-ai-cost-attribution.cjs \
 && node --check /app/server-email-action-recovery.cjs \
 && node --check /app/server-email-trash-core.cjs \
 && node --check /app/server-role-policy.cjs \
 && node --check /app/server-permission-policy.cjs \
 && node --check /app/server-email-accounting-core.cjs \
 && node --check /app/server-email-accounting.cjs \
 && node --check /app/server-google-mail-core.cjs \
 && node --check /app/server-google-mail.cjs \
 && node -e "JSON.parse(require('node:fs').readFileSync('/app/permission-catalog.json','utf8'))" \
 && node --check /app/server-client-onboarding.cjs \
 && node --check /app/server-user-access.cjs \
 && node --check /app/server-project-data.cjs \
 && node --check /app/server-nova-routing.cjs \
 && node --check /app/server-ai-cost-ledger-aggregate.cjs \
 && node --check /app/server-cost-centers.cjs \
 && node --check /app/server-client-costs.cjs \
 && node --check /app/server-openai-cost-diagnostic.cjs \
 && node --check /app/server-cost-accounting-core.cjs \
 && node --check /app/server-provider-cost-imports.cjs \
 && node --check /app/server-agent-registry.cjs \
 && node --check /app/server-led-ad-director.cjs \
 && node --check /app/server-agent-orchestrator.cjs \
 && node --check /app/server-agent-orchestrator-resilient.cjs \
 && node --check /app/server-agent-run-log.cjs \
 && node --check /app/server-domain-ops.cjs \
 && node --check /app/server-ionos-dns.cjs \
 && node --check /app/server-settings.cjs \
 && node --check /app/server-social-command.cjs \
 && node --check /app/server-signage.cjs \
 && node --check /app/server-villeconnect.cjs \
 && node --check /app/server-video-provenance-core.cjs \
 && node --check /app/server-video-provenance.cjs \
 && node --check /app/server-video-studio.cjs \
 && node --check /app/server-video-generation-core.cjs \
 && node --check /app/server-video-generation.cjs \
 && node --check /app/server-audio-library.cjs \
 && node --check /app/server-assistant-batch.cjs \
 && node --check /app/server-task-batch.cjs \
 && node --check /app/server-task-context.cjs \
 && node --check /app/server-nova-executors.cjs \
 && node --check /app/server-nova-video-direct.cjs \
 && node --check /app/server-immediate-execution-policy.cjs \
 && node --check /app/server-task-autopilot.cjs \
 && node --check /app/server-bce.cjs \
 && node --check /app/server-public-elynea.cjs \
 && node --check /app/lib/governance-export.cjs \
 && node -e "require('/app/server-led-ad-director.cjs'); require('/app/server-agent-registry.cjs'); require('/app/server-nova-routing.cjs'); require('/app/server-social-command.cjs')" \
 && node -e "require('/app/server-task-context.cjs'); require('/app/server-assistant-batch.cjs'); require('/app/server-specialist-tasks.cjs')" \
 && echo "Required runtime modules check OK"

RUN mkdir -p /etc/nginx/http.d && cat > /etc/nginx/http.d/default.conf << 'NGINXEOF'
server {
    listen __PORT__;
    root /app/dist;
    index index.html;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self' https://*.supabase.co https://*.railway.app https://app.base44.com https://api.base44.com wss://*.supabase.co http://127.0.0.1:8787 http://localhost:8787 http://127.0.0.1:8788 http://localhost:8788 http://127.0.0.1:8791 http://localhost:8791 http://127.0.0.1:8792 http://localhost:8792 http://127.0.0.1:8793 http://localhost:8793; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(self), geolocation=()" always;
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

RUN printf '#!/bin/sh\nsed -i "s/__PORT__/${PORT:-3000}/" /etc/nginx/http.d/default.conf\nnode /app/server.cjs &\nnginx -g "daemon off;"\n' > /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]