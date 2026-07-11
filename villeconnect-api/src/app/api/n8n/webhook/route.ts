/**
 * POST /api/n8n/webhook
 *
 * Méthode : POST
 * Auth    : HMAC-SHA256 + horodatage TTL 5min + idempotency key (anti-rejeu)
 * Rôles   : n/a (authentification via signature, pas JWT)
 * Effet   : met à jour ai_action_logs + entité concernée + Supabase Realtime
 * Erreurs : 401 (signature), 408 (expiré), 409 (rejeu), 422, 500
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateInboundN8nRequest } from '@/lib/n8n';
import { supabaseAdmin, transitionActionStatus } from '@/lib/supabase';
import type { ApiResponse, N8nWebhookRequest } from '@/lib/types';

const REPLAY_TTL_SECONDS = 300;  // 5 minutes

const BodySchema = z.object({
  action_log_id:    z.string().uuid().optional(),
  n8n_execution_id: z.string().optional(),
  city_id:          z.string().uuid(),
  status:           z.enum(['completed', 'failed', 'running']),
  workflow:         z.string().optional(),
  result:           z.record(z.unknown()).optional(),
  error_message:    z.string().optional(),
  entity_id:        z.string().uuid().optional(),
  entity_type:      z.string().optional(),
  idempotency_key:  z.string().min(1),   // obligatoire — anti-rejeu
  timestamp:        z.string(),          // ISO — vérifié pour TTL
});

// Table en mémoire des idempotency_key reçus (+ Supabase pour persistence)
const seen = new Set<string>();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  // 1. Vérification HMAC + horodatage TTL
  const tsHeader = req.headers.get('x-n8n-timestamp') ?? '';
  const tsNum = parseInt(tsHeader, 10);
  if (isNaN(tsNum) || Date.now() / 1000 - tsNum > REPLAY_TTL_SECONDS) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'expired', message: 'Requête expirée (TTL 5min)' }, { status: 408 });
  }
  if (!validateInboundN8nRequest(req as unknown as Request, rawBody)) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'unauthorized', message: 'Signature HMAC invalide' }, { status: 401 });
  }

  // 2. Parse + validation
  let body: N8nWebhookRequest;
  try {
    const p = BodySchema.safeParse(JSON.parse(rawBody));
    if (!p.success) return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error',
      message: p.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 422 });
    body = p.data as N8nWebhookRequest;
  } catch { return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: 'JSON invalide' }, { status: 422 }); }

  // 3. Anti-rejeu — vérifie l'idempotency_key
  if (!body.action_log_id && !body.n8n_execution_id) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: 'action_log_id ou n8n_execution_id requis' }, { status: 422 });
  }
  const iKey = body.idempotency_key;
  if (seen.has(iKey)) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'conflict', message: 'Idempotency key déjà traitée (anti-rejeu)' }, { status: 409 });
  }
  // Vérifie aussi en DB
  const { data: existing } = await supabaseAdmin.from('vc_n8n_idempotency').select('id').eq('key', iKey).maybeSingle().then(r => r, () => ({ data: null }));
  if (existing) return NextResponse.json<ApiResponse>({ success: false, error: 'conflict', message: 'Idempotency key déjà traitée (DB)' }, { status: 409 });

  seen.add(iKey);
  await supabaseAdmin.from('vc_n8n_idempotency').insert({ key: iKey, created_at: new Date().toISOString() }).then(() => {}, () => {});

  // 4. Transition machine d'états (executing → succeeded/failed)
  if (body.action_log_id) {
    const toStatus = body.status === 'completed' ? 'succeeded' : body.status === 'failed' ? 'failed' : 'executing';
    if (toStatus !== 'executing') {
      const transitioned = await transitionActionStatus(body.action_log_id, 'executing', toStatus,
        { n8nExecutionId: body.n8n_execution_id });
      if (!transitioned) console.warn(`[n8n-webhook] Transition échouée pour ${body.action_log_id} — état concurrent?`);
    }
  }

  // 5. Mise à jour entité concernée
  if (body.status === 'completed' && body.entity_id && body.entity_type) {
    const now = new Date().toISOString();
    if (body.entity_type === 'announcement') {
      await supabaseAdmin.from('vc_announcements').update({ status: 'published', updated_at: now }).eq('id', body.entity_id).eq('city_id', body.city_id);
    } else if (body.entity_type === 'campaign') {
      await supabaseAdmin.from('vc_campaigns').update({ status: 'active', updated_at: now }).eq('id', body.entity_id).eq('city_id', body.city_id);
    }
  }

  // 6. Notification Supabase Realtime (non-bloquant)
  supabaseAdmin.channel(`city:${body.city_id}:actions`).send({
    type: 'broadcast', event: 'action_status_update',
    payload: { action_log_id: body.action_log_id, status: body.status, entity_id: body.entity_id, timestamp: new Date().toISOString() },
  }).then(() => {}, () => {});

  return NextResponse.json<ApiResponse>({ success: true, data: { processed: true, idempotency_key: iKey } });
}
