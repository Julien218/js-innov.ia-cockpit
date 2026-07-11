/**
 * POST /api/chat
 *
 * Méthode     : POST
 * Auth        : Bearer JWT Supabase (obligatoire)
 * Rôles       : citizen, agent, admin, superadmin
 * city_id     : extrait du JWT (jamais du body client)
 * Effet       : crée/récupère conversation, exécute agent, stocke messages, vectorise
 * Erreurs     : 401 (no token), 403 (city mismatch), 422 (validation), 429 (rate limit), 500
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, assertCityAccess, authErrorResponse, AuthError } from '@/lib/auth';
import { checkRateLimits } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase';
import { logRunStart } from '@/lib/action-logger';
import { runAgent } from '@/agents/index';
import type { AgentServerContext } from '@/agents/server-context';
import type { ApiResponse, ChatRequest, ChatResponse } from '@/lib/types';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Validation Zod ────────────────────────────────────────────────────────────
const ChatBodySchema = z.object({
  message:         z.string().min(1).max(4000),
  city_id:         z.string().uuid(),   // confirmé contre le JWT — pas aveuglément utilisé
  conversation_id: z.string().uuid().optional(),
  channel:         z.enum(['web', 'mobile', 'telegram', 'whatsapp']),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth — city_id vient du JWT
  let authCtx;
  try { authCtx = await authenticate(req); }
  catch (e) { return authErrorResponse(e); }

  // 2. Parse + validate body
  let body: ChatRequest;
  try {
    const raw = await req.json();
    const parsed = ChatBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse>({
        success: false, error: 'validation_error',
        message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      }, { status: 422 });
    }
    body = parsed.data as ChatRequest;
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: 'JSON invalide' }, { status: 422 });
  }

  // 3. Vérification city_id : le body doit correspondre au JWT (jamais faire confiance au client seul)
  try { assertCityAccess(authCtx, body.city_id); }
  catch (e) { return authErrorResponse(e); }

  // 4. Rate limiting
  const rl = await checkRateLimits(authCtx.userId, authCtx.cityId);
  if (!rl.allowed) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'rate_limited', message: rl.reason }, { status: 429 });
  }

  // 5. Chargement de la ville (côté serveur uniquement)
  const { data: city, error: cityErr } = await supabaseAdmin
    .from('vc_cities').select('*').eq('id', authCtx.cityId).eq('is_active', true).single();
  if (cityErr || !city) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'not_found', message: 'Ville introuvable' }, { status: 404 });
  }

  // 6. Conversation
  let conversationId: string = body.conversation_id ?? '';
  if (!conversationId) {
    const { data: conv, error: convErr } = await supabaseAdmin.from('vc_conversations').insert({
      city_id: authCtx.cityId, user_id: authCtx.userId,
      session_id: crypto.randomUUID(), channel: body.channel, status: 'active',
    }).select('id').single();
    if (convErr || !conv) return NextResponse.json<ApiResponse>({ success: false, error: 'server_error', message: 'Impossible de créer la conversation' }, { status: 500 });
    conversationId = conv.id;
  }

  // 7. Pré-création du log d'action (backend, pas l'agent)
  const actionLogId = await logRunStart({
    cityId: authCtx.cityId, agentName: 'VilleConnect Copilot',
    actionType: 'chat_message', entityType: 'conversation', entityId: conversationId,
    inputSummary: body.message.slice(0, 200), riskLevel: 'low',
  });

  // 8. Stocke le message utilisateur
  const { data: userMsg } = await supabaseAdmin.from('vc_messages').insert({
    conversation_id: conversationId, city_id: authCtx.cityId,
    user_id: authCtx.userId, role: 'user', content: body.message,
  }).select('id').single();

  // 9. Exécute l'agent (city_id/userId passés via contexte serveur typé, jamais via prompt)
  const serverCtx: AgentServerContext = {
    auth: authCtx, city, conversationId, actionLogId, startedAt: Date.now(),
  };

  let agentResult;
  try {
    agentResult = await runAgent(body.message, serverCtx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur agent';
    return NextResponse.json<ApiResponse>({ success: false, error: 'agent_error', message: msg }, { status: 500 });
  }

  // 10. Stocke la réponse + embedding
  const { data: assistantMsg } = await supabaseAdmin.from('vc_messages').insert({
    conversation_id: conversationId, city_id: authCtx.cityId,
    user_id: authCtx.userId, role: 'assistant', content: agentResult.response,
    model_used: 'gpt-4o',
  }).select('id').single();

  // Vectorisation asynchrone (non-bloquant)
  if (assistantMsg?.id) {
    openai.embeddings.create({ model: 'text-embedding-3-small', input: agentResult.response })
      .then(emb => supabaseAdmin.from('vc_messages').update({ embedding: emb.data[0].embedding }).eq('id', assistantMsg.id))
      .catch(e => console.error('[chat] Erreur vectorisation:', e));
  }

  const response: ChatResponse = {
    reply: agentResult.response,
    conversation_id: conversationId,
    message_id: (assistantMsg?.id ?? '') as string,
    pending_validation: agentResult.pendingValidation,   // calculé depuis les interruptions réelles
    action_log_id: agentResult.pendingValidation ? actionLogId : undefined,
    interruption: agentResult.interruption ? { tool_name: agentResult.interruption.toolName, tool_input: agentResult.interruption.toolInput, description: agentResult.interruption.description, risk_level: 'high' as const } : undefined,
  };

  return NextResponse.json<ApiResponse<ChatResponse>>({ success: true, data: response });
}
