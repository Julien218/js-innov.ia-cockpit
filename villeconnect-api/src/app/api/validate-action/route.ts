/**
 * POST /api/validate-action
 *
 * Méthode     : POST
 * Auth        : Bearer JWT Supabase (obligatoire)
 * Rôles       : admin, superadmin uniquement
 * city_id     : extrait du JWT et vérifié contre l'action
 * Effet       : approved → reprend le run agent | rejected → archive + log
 * Erreurs     : 401, 403, 404, 409 (mauvais état), 422, 500
 *
 * Garantie d'idempotence : la transition approved→executing est atomique
 * via UPDATE WHERE status='approved'. Une double approbation retourne 409.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, requireAdmin, assertCityAccess, authErrorResponse } from '@/lib/auth';
import { supabaseAdmin, transitionActionStatus } from '@/lib/supabase';
import { triggerWorkflow } from '@/lib/n8n';
import { logValidationDecision } from '@/lib/action-logger';
import { resumeAgentAfterApproval } from '@/agents/index';
import type { AgentServerContext } from '@/agents/server-context';
import type { ApiResponse, ValidateActionRequest, ValidateActionResponse, AiActionLog } from '@/lib/types';

const BodySchema = z.object({
  action_log_id:    z.string().uuid(),
  decision:         z.enum(['approved', 'rejected']),
  rejection_reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth + rôle admin
  let authCtx;
  try {
    authCtx = await authenticate(req);
    requireAdmin(authCtx);
  } catch (e) { return authErrorResponse(e); }

  // 2. Validation body
  let body: ValidateActionRequest;
  try {
    const raw = await req.json();
    const p = BodySchema.safeParse(raw);
    if (!p.success) return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error',
      message: p.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 422 });
    body = p.data;
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: 'JSON invalide' }, { status: 422 });
  }

  // 3. Charge l'action — vérifie city_id appartient au validateur
  const { data: action, error: fetchErr } = await supabaseAdmin
    .from('ai_action_logs').select('*').eq('id', body.action_log_id).single();
  if (fetchErr || !action) return NextResponse.json<ApiResponse>({ success: false, error: 'not_found', message: 'Action introuvable' }, { status: 404 });

  const log = action as AiActionLog;

  // Vérifie que l'admin a accès à la ville de l'action (pas seulement la sienne)
  try { assertCityAccess(authCtx, log.city_id ?? ''); }
  catch (e) { return authErrorResponse(e); }

  // 4. L'action doit être en pending_validation
  if (log.status !== 'pending_validation') {
    return NextResponse.json<ApiResponse>({
      success: false, error: 'conflict',
      message: `Transition invalide: l'action est en status '${log.status}', attendu 'pending_validation'`,
    }, { status: 409 });
  }

  // 5. REFUS — transition atomique pending_validation → rejected
  if (body.decision === 'rejected') {
    const transitioned = await transitionActionStatus(
      body.action_log_id, 'pending_validation', 'rejected',
      { validatedBy: authCtx.userId, rejectionReason: body.rejection_reason }
    );
    if (!transitioned) return NextResponse.json<ApiResponse>({ success: false, error: 'conflict', message: 'Transition concurrente détectée' }, { status: 409 });

    await logValidationDecision(body.action_log_id, 'rejected', authCtx.userId, body.rejection_reason);
    return NextResponse.json<ApiResponse<ValidateActionResponse>>({
      success: true,
      data: { action_log_id: body.action_log_id, new_status: 'rejected', n8n_triggered: false },
    });
  }

  // 6. APPROBATION — transition atomique pending_validation → approved
  const transitioned = await transitionActionStatus(
    body.action_log_id, 'pending_validation', 'approved',
    { validatedBy: authCtx.userId }
  );
  if (!transitioned) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'conflict', message: 'Double approbation détectée ou état concurrent' }, { status: 409 });
  }
  await logValidationDecision(body.action_log_id, 'approved', authCtx.userId);

  // 7. Reprise du run agent depuis le RunState sérialisé
  let n8nTriggered = false;
  if (log.run_state?.serialized) {
    const { data: city } = await supabaseAdmin.from('vc_cities').select('*').eq('id', log.city_id ?? '').single();
    if (city) {
      const serverCtx: AgentServerContext = {
        auth: { userId: log.validated_by ?? authCtx.userId, email: null, cityId: log.city_id ?? '', role: 'admin', channel: 'web' },
        city, conversationId: log.entity_id ?? '', actionLogId: body.action_log_id, startedAt: Date.now(),
      };
      try {
        await resumeAgentAfterApproval(log.run_state.serialized, serverCtx);
        n8nTriggered = true;
      } catch (err) {
        console.error('[validate-action] Erreur reprise agent:', err instanceof Error ? err.message : err);
        await transitionActionStatus(body.action_log_id, 'approved', 'failed');
        return NextResponse.json<ApiResponse>({ success: false, error: 'agent_resume_error', message: 'Erreur lors de la reprise du run' }, { status: 500 });
      }
    }
  } else {
    // Pas de RunState → déclenche n8n directement si action type connu
    const idempotencyKey = `${body.action_log_id}:${authCtx.userId}:${Date.now()}`;
    const wfName = mapActionTypeToWorkflow(log.action_type);
    if (wfName) {
      const n8nResult = await triggerWorkflow(wfName, log.metadata, log.city_id ?? '', body.action_log_id, idempotencyKey);
      n8nTriggered = n8nResult.success;
    }
  }

  return NextResponse.json<ApiResponse<ValidateActionResponse>>({
    success: true,
    data: { action_log_id: body.action_log_id, new_status: 'approved', n8n_triggered: n8nTriggered },
  });
}

function mapActionTypeToWorkflow(actionType: string): import('@/lib/types').N8nWorkflowName | null {
  const map: Record<string, import('@/lib/types').N8nWorkflowName> = {
    publish_announcement: 'publish_announcement',
    activate_campaign:    'activate_campaign',
    notify_bug_resolved:  'notify_bug_resolved',
    send_notification:    'send_notification',
  };
  return map[actionType] ?? null;
}
