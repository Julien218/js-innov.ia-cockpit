/**
 * GET /api/action-logs
 *
 * Méthode : GET
 * Auth    : JWT, rôles admin/superadmin uniquement
 * city_id : extrait JWT, vérifié. Superadmin peut filtrer sur n'importe quelle ville.
 * Effet   : lecture paginée de ai_action_logs avec filtres
 * Erreurs : 401, 403, 422, 500
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, requireAdmin, assertCityAccess, authErrorResponse } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import type { ApiResponse, PaginatedResponse, AiActionLog } from '@/lib/types';

const GetSchema = z.object({
  city_id:     z.string().uuid(),
  status:      z.enum(['draft','pending_validation','approved','rejected','executing','succeeded','failed','cancelled']).optional(),
  risk_level:  z.enum(['low','medium','high','critical']).optional(),
  entity_type: z.string().optional(),
  agent_name:  z.string().optional(),
  date_start:  z.string().datetime().optional(),
  date_end:    z.string().datetime().optional(),
  limit:       z.coerce.number().min(1).max(200).default(50),
  offset:      z.coerce.number().min(0).default(0),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  let authCtx; try { authCtx = await authenticate(req); requireAdmin(authCtx); } catch(e) { return authErrorResponse(e); }
  const p = GetSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: p.error.issues.map(i=>i.message).join('; ') }, { status: 422 });
  try { assertCityAccess(authCtx, p.data.city_id); } catch(e) { return authErrorResponse(e); }

  let q = supabaseAdmin.from('ai_action_logs').select('*', { count: 'exact' })
    .eq('city_id', authCtx.role === 'superadmin' ? p.data.city_id : authCtx.cityId)
    .order('created_at', { ascending: false })
    .range(p.data.offset, p.data.offset + p.data.limit - 1);

  if (p.data.status)      q = q.eq('status', p.data.status);
  if (p.data.risk_level)  q = q.eq('risk_level', p.data.risk_level);
  if (p.data.entity_type) q = q.eq('entity_type', p.data.entity_type);
  if (p.data.agent_name)  q = q.ilike('agent_name', `%${p.data.agent_name}%`);
  if (p.data.date_start)  q = q.gte('created_at', p.data.date_start);
  if (p.data.date_end)    q = q.lte('created_at', p.data.date_end);

  const { data, error, count } = await q;
  if (error) return NextResponse.json<ApiResponse>({ success: false, error: 'server_error', message: error.message }, { status: 500 });
  return NextResponse.json<ApiResponse<PaginatedResponse<AiActionLog>>>({ success: true, data: {
    items: (data ?? []) as AiActionLog[], total: count ?? 0,
    limit: p.data.limit, offset: p.data.offset, has_more: (p.data.offset + p.data.limit) < (count ?? 0),
  }});
}
