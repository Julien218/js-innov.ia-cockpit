/**
 * POST /api/n8n/webhook
 *
 * Auth    : HMAC-SHA256 (header X-N8N-Signature) + horodatage TTL 5min (X-N8N-Timestamp)
 * Mode    : FAIL CLOSED — toute erreur Supabase bloque la requete (pas d'erreur silencieuse)
 *
 * Flux strict (ordre obligatoire) :
 *   1. Signature HMAC valide
 *   2. Timestamp valide (TTL 5min)
 *   3. Validation Zod du body
 *   4. INSERT atomique de l'idempotency_key (PRIMARY KEY UNIQUE)
 *      → conflit = 409 Replay
 *      → erreur DB = 503 (fail closed, aucun effet externe)
 *   5. Transition machine d'etats (executing → succeeded/failed)
 *   6. Mise a jour entite concernee
 *   7. Notification Realtime (non-bloquant, echec accepte)
 *
 * Le Set memoire est une OPTIMISATION LOCALE uniquement (evite un aller-retour DB
 * pour les requetes evidemment dupliquees dans la meme instance). La source de
 * verite est toujours la PRIMARY KEY de vc_n8n_idempotency.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateInboundN8nRequest } from '@/lib/n8n';
import { supabaseAdmin, transitionActionStatus } from '@/lib/supabase';
import type { ApiResponse, N8nWebhookRequest } from '@/lib/types';

const REPLAY_TTL_SECONDS = 300; // 5 minutes

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
  idempotency_key:  z.string().min(1),
  timestamp:        z.string(),
});

// Optimisation locale uniquement — PAS une garantie de securite
const localSeenKeys = new Set<string>();

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Etape 1 : Timestamp TTL ────────────────────────────────────────────────
  const rawBody = await req.text();
  const tsHeader = req.headers.get('x-n8n-timestamp') ?? '';
  const tsNum = parseInt(tsHeader, 10);
  if (isNaN(tsNum) || Date.now() / 1000 - tsNum > REPLAY_TTL_SECONDS) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'expired', message: 'Requete expiree (TTL 5min)' },
      { status: 408 },
    );
  }

  // ── Etape 2 : Signature HMAC ───────────────────────────────────────────────
  if (!validateInboundN8nRequest(req as unknown as Request, rawBody)) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'unauthorized', message: 'Signature HMAC invalide' },
      { status: 401 },
    );
  }

  // ── Etape 3 : Validation Zod ───────────────────────────────────────────────
  let body: N8nWebhookRequest;
  try {
    const parsed = BodySchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'validation_error', message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') },
        { status: 422 },
      );
    }
    body = parsed.data as N8nWebhookRequest;
  } catch {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'validation_error', message: 'JSON invalide' },
      { status: 422 },
    );
  }

  if (!body.action_log_id && !body.n8n_execution_id) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'validation_error', message: 'action_log_id ou n8n_execution_id requis' },
      { status: 422 },
    );
  }

  // ── Etape 4 : Reservation atomique de l'idempotency_key ───────────────────
  // Optimisation memoire locale (court-circuit avant aller-retour DB)
  const iKey = body.idempotency_key;
  if (localSeenKeys.has(iKey)) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'conflict', message: 'Rejeu detecte (cache local)' },
      { status: 409 },
    );
  }

  // INSERT atomique — PRIMARY KEY garantit l'unicite entre instances et redemarrages
  const { error: insertError } = await supabaseAdmin
    .from('vc_n8n_idempotency')
    .insert({
      key:       iKey,
      city_id:   body.city_id,
      workflow:  body.workflow ?? null,
      // expires_at utilise le DEFAULT (now() + 24h) de la table
    });

  if (insertError) {
    // Code 23505 = violation contrainte UNIQUE (rejeu detecte par la DB)
    if (insertError.code === '23505') {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'conflict', message: 'Idempotency key deja traitee (DB)' },
        { status: 409 },
      );
    }
    // Toute autre erreur DB : fail closed — on ne traite pas la requete
    console.error('[n8n-webhook] Erreur DB idempotency INSERT:', insertError.code, insertError.message);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'service_unavailable', message: 'Erreur de stockage idempotence — requete non traitee' },
      { status: 503 },
    );
  }

  // Reservation reussie — on peut maintenant produire des effets externes
  localSeenKeys.add(iKey);

  // ── Etape 5 : Transition machine d'etats ──────────────────────────────────
  if (body.action_log_id) {
    const toStatus = body.status === 'completed' ? 'succeeded' : body.status === 'failed' ? 'failed' : null;
    if (toStatus) {
      const transitioned = await transitionActionStatus(
        body.action_log_id, 'executing', toStatus,
        { n8nExecutionId: body.n8n_execution_id },
      );
      if (!transitioned) {
        // L'action n'etait pas en 'executing' — log et continue (n8n peut rappeler)
        console.warn(`[n8n-webhook] Transition echouee pour ${body.action_log_id} (etat courant != executing)`);
      }
    }
  }

  // ── Etape 6 : Mise a jour entite ──────────────────────────────────────────
  if (body.status === 'completed' && body.entity_id && body.entity_type) {
    const now = new Date().toISOString();
    if (body.entity_type === 'announcement') {
      await supabaseAdmin
        .from('vc_announcements')
        .update({ status: 'published', updated_at: now })
        .eq('id', body.entity_id)
        .eq('city_id', body.city_id);
    } else if (body.entity_type === 'campaign') {
      await supabaseAdmin
        .from('vc_campaigns')
        .update({ status: 'active', updated_at: now })
        .eq('id', body.entity_id)
        .eq('city_id', body.city_id);
    }
  }

  // ── Etape 7 : Notification Realtime (non-bloquant, echec accepte) ──────────
  supabaseAdmin.channel(`city:${body.city_id}:actions`).send({
    type: 'broadcast',
    event: 'action_status_update',
    payload: {
      action_log_id: body.action_log_id,
      status: body.status,
      entity_id: body.entity_id,
      timestamp: new Date().toISOString(),
    },
  }).catch((e: unknown) => {
    // Realtime est best-effort — on ne bloque jamais sur son echec
    console.warn('[n8n-webhook] Realtime echec:', e instanceof Error ? e.message : e);
  });

  return NextResponse.json<ApiResponse>({
    success: true,
    data: { processed: true, idempotency_key: iKey },
  });
}
