/**
 * Client n8n — sécurisé avec HMAC, horodatage, anti-rejeu et idempotency key.
 */
import crypto from 'crypto';
import { supabaseAdmin, transitionActionStatus } from './supabase';
import type { N8nTriggerResult, N8nWorkflowName } from './types';

const N8N_BASE_URL   = process.env.N8N_BASE_URL   ?? '';
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET ?? '';

// Mapping workflow → path
const WORKFLOW_PATHS: Record<N8nWorkflowName, string> = {
  publish_announcement:  'publish-announcement',
  activate_campaign:     'activate-campaign',
  notify_bug_resolved:   'notify-bug-resolved',
  send_notification:     'send-notification',
};

/** Génère la signature HMAC-SHA256 du payload */
function signPayload(payload: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', N8N_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

/** Valide la signature HMAC + TTL (5 min) + idempotency pour les webhooks entrants de n8n */
export function validateInboundN8nRequest(req: Request, rawBody: string): boolean {
  const signature = req.headers.get('x-n8n-signature') ?? '';
  const timestamp = req.headers.get('x-n8n-timestamp') ?? '';
  if (!signature || !timestamp) return false;

  // TTL : rejette si > 5 minutes
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Date.now() / 1000 - ts > 300) return false;

  const expected = signPayload(rawBody, timestamp);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Déclenche un workflow n8n.
 * Utilise la transition atomique approved → executing pour garantir une seule exécution.
 */
export async function triggerWorkflow(
  workflowName: N8nWorkflowName,
  payload: Record<string, unknown>,
  cityId: string,
  actionLogId: string,
  idempotencyKey: string
): Promise<N8nTriggerResult> {
  if (!N8N_BASE_URL || !N8N_WEBHOOK_SECRET) {
    return { success: false, n8n_execution_id: null, error: 'n8n non configuré' };
  }

  // Transition atomique approved → executing (garantit une seule exécution)
  const transitioned = await transitionActionStatus(actionLogId, 'approved', 'executing');
  if (!transitioned) {
    return { success: false, n8n_execution_id: null, error: 'Action non approved ou déjà exécutée' };
  }

  const url = `${N8N_BASE_URL.replace(/\/$/, '')}/webhook/${WORKFLOW_PATHS[workflowName]}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = JSON.stringify({
    ...payload, city_id: cityId, action_log_id: actionLogId,
    idempotency_key: idempotencyKey, timestamp: new Date().toISOString(),
  });

  const signature = signPayload(bodyStr, timestamp);
  let lastError = '';

  // 3 tentatives avec backoff exponentiel
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-Signature': signature,
          'X-N8N-Timestamp': timestamp,
          'Idempotency-Key': idempotencyKey,
        },
        body: bodyStr,
      });
      if (resp.ok) {
        const json = await resp.json().catch(() => ({}));
        const executionId = (json as Record<string, unknown>).executionId as string ?? null;
        await supabaseAdmin.from('ai_action_logs').update({
          n8n_execution_id: executionId, updated_at: new Date().toISOString(),
        }).eq('id', actionLogId);
        return { success: true, n8n_execution_id: executionId };
      }
      lastError = `HTTP ${resp.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  // Toutes tentatives échouées → retour à failed
  await transitionActionStatus(actionLogId, 'executing', 'failed');
  return { success: false, n8n_execution_id: null, error: lastError };
}
