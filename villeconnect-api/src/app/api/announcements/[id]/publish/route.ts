/**
 * POST /api/announcements/[id]/publish
 *
 * Méthode : POST
 * Auth    : JWT, rôles admin/superadmin uniquement
 * city_id : vérifié contre l'annonce en DB
 * Effet   : draft/pending_validation → pending_validation + déclenche n8n publish_announcement
 * Erreurs : 401, 403, 404, 409 (statut invalide), 500
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireAdmin, assertCityAccess, authErrorResponse } from '@/lib/auth';
import { supabaseAdmin, transitionActionStatus } from '@/lib/supabase';
import { triggerWorkflow } from '@/lib/n8n';
import { logRunStart } from '@/lib/action-logger';
import type { ApiResponse } from '@/lib/types';

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  let authCtx; try { authCtx = await authenticate(req); requireAdmin(authCtx); } catch(e) { return authErrorResponse(e); }

  const { data: ann, error: fetchErr } = await supabaseAdmin
    .from('vc_announcements').select('*').eq('id', params.id).single();
  if (fetchErr || !ann) return NextResponse.json<ApiResponse>({ success: false, error: 'not_found', message: 'Annonce introuvable' }, { status: 404 });

  // Vérifie appartenance ville
  try { assertCityAccess(authCtx, ann.city_id); } catch(e) { return authErrorResponse(e); }

  // Seules les annonces en draft ou pending_validation peuvent être publiées
  if (!['draft','pending_validation'].includes(ann.status)) {
    return NextResponse.json<ApiResponse>({ success: false, error: 'conflict',
      message: `Impossible de publier une annonce en statut '${ann.status}'` }, { status: 409 });
  }

  // Passe en pending_validation
  await supabaseAdmin.from('vc_announcements').update({ status: 'pending_validation', validated_by: authCtx.userId, validated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', params.id);

  // Crée l'action log et déclenche n8n (la transition approved→executing est dans triggerWorkflow)
  const actionLogId = await logRunStart({
    cityId: ann.city_id, agentName: 'Admin Cockpit',
    actionType: 'publish_announcement', entityType: 'announcement', entityId: params.id,
    inputSummary: `Publication annonce: ${ann.title}`, riskLevel: 'medium',
  });

  // Transition log: draft → pending_validation → approved (admin vient de valider manuellement)
  await transitionActionStatus(actionLogId, 'draft', 'pending_validation');
  await transitionActionStatus(actionLogId, 'pending_validation', 'approved', { validatedBy: authCtx.userId });

  const idempotencyKey = `publish:${params.id}:${authCtx.userId}`;
  const n8nResult = await triggerWorkflow('publish_announcement', { announcement_id: params.id, title: ann.title }, ann.city_id, actionLogId, idempotencyKey);

  return NextResponse.json<ApiResponse>({ success: true, data: { announcement_id: params.id, n8n_triggered: n8nResult.success, action_log_id: actionLogId } });
}
