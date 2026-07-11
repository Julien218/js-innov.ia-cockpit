/**
 * GET  /api/announcements  — liste les annonces d'une ville
 * POST /api/announcements  — crée un brouillon manuel
 *
 * Méthode GET  : Auth JWT, rôles citizen/agent/admin
 * Méthode POST : Auth JWT, rôles agent/admin
 * city_id : extrait du JWT + vérifié
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, assertCityAccess, authErrorResponse } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import type { ApiResponse, PaginatedResponse, VcAnnouncement } from '@/lib/types';

const GetSchema = z.object({
  city_id:  z.string().uuid(),
  status:   z.enum(['draft','pending_validation','published','archived','rejected']).optional(),
  category: z.enum(['info','event','alert','commercial']).optional(),
  priority: z.enum(['low','medium','high','urgent']).optional(),
  limit:    z.coerce.number().min(1).max(100).default(20),
  offset:   z.coerce.number().min(0).default(0),
});

const PostSchema = z.object({
  city_id:  z.string().uuid(),
  title:    z.string().min(5).max(200),
  content:  z.string().min(20).max(5000),
  category: z.enum(['info','event','alert','commercial']),
  priority: z.enum(['low','medium','high','urgent']).default('medium'),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  let authCtx; try { authCtx = await authenticate(req); } catch(e) { return authErrorResponse(e); }
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const p = GetSchema.safeParse(params);
  if (!p.success) return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: p.error.issues.map(i=>i.message).join('; ') }, { status: 422 });
  try { assertCityAccess(authCtx, p.data.city_id); } catch(e) { return authErrorResponse(e); }

  let q = supabaseAdmin.from('vc_announcements').select('*', { count: 'exact' })
    .eq('city_id', authCtx.cityId).order('created_at', { ascending: false })
    .range(p.data.offset, p.data.offset + p.data.limit - 1);
  if (p.data.status)   q = q.eq('status', p.data.status);
  if (p.data.category) q = q.eq('category', p.data.category);
  if (p.data.priority) q = q.eq('priority', p.data.priority);

  // Citoyens : uniquement published
  if (authCtx.role === 'citizen') q = q.eq('status', 'published');

  const { data, error, count } = await q;
  if (error) return NextResponse.json<ApiResponse>({ success: false, error: 'server_error', message: error.message }, { status: 500 });

  return NextResponse.json<ApiResponse<PaginatedResponse<VcAnnouncement>>>({ success: true, data: {
    items: (data ?? []) as VcAnnouncement[],
    total: count ?? 0, limit: p.data.limit, offset: p.data.offset,
    has_more: (p.data.offset + p.data.limit) < (count ?? 0),
  }});
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let authCtx; try { authCtx = await authenticate(req); } catch(e) { return authErrorResponse(e); }
  if (authCtx.role === 'citizen') return NextResponse.json<ApiResponse>({ success: false, error: 'forbidden', message: 'Les citoyens ne peuvent pas créer des annonces' }, { status: 403 });

  let body; try {
    const raw = await req.json();
    const p = PostSchema.safeParse(raw);
    if (!p.success) return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: p.error.issues.map(i=>i.message).join('; ') }, { status: 422 });
    body = p.data;
  } catch { return NextResponse.json<ApiResponse>({ success: false, error: 'validation_error', message: 'JSON invalide' }, { status: 422 }); }

  try { assertCityAccess(authCtx, body.city_id); } catch(e) { return authErrorResponse(e); }

  const { data, error } = await supabaseAdmin.from('vc_announcements').insert({
    city_id: authCtx.cityId, author_id: authCtx.userId,
    title: body.title, content: body.content, category: body.category, priority: body.priority,
    status: 'draft', ai_generated: false,
  }).select('*').single();
  if (error) return NextResponse.json<ApiResponse>({ success: false, error: 'server_error', message: error.message }, { status: 500 });
  return NextResponse.json<ApiResponse<VcAnnouncement>>({ success: true, data: data as VcAnnouncement }, { status: 201 });
}
