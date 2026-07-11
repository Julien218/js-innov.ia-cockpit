/**
 * Authentification et autorisation — serveur uniquement.
 * city_id, user_id et role sont extraits du JWT Supabase,
 * jamais passés dans le prompt ou le body applicatif non vérifié.
 */
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import type { AuthContext, UserRole, RequestChannel } from './types';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

/**
 * Extrait et valide le contexte auth depuis le Bearer token.
 * Retourne AuthContext ou lève une erreur 401/403.
 */
export async function authenticate(req: NextRequest): Promise<AuthContext> {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new AuthError(401, 'Token Bearer manquant');
  }
  const token = authHeader.slice(7);

  // Vérification du JWT via Supabase (côté serveur, avec le token utilisateur)
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthError(401, 'Token invalide ou expiré');

  // Extrait les claims custom du JWT (injectés via Supabase auth hooks)
  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const cityId = (appMeta['city_id'] as string) ?? null;
  const role = ((appMeta['role'] as string) ?? 'citizen') as UserRole;

  if (!cityId) throw new AuthError(403, 'Aucun city_id associé à ce compte');

  // Détermine le canal depuis l'Origin
  const origin = req.headers.get('origin') ?? '';
  const cockpitUrl = process.env.COCKPIT_URL ?? 'https://cockpit.jsinnovia.com';
  const channel: RequestChannel = origin.startsWith(cockpitUrl) ? 'web' : 'mobile';

  return { userId: user.id, email: user.email ?? null, cityId, role, channel };
}

/** Vérifie que l'utilisateur est admin ou superadmin, sinon lève 403 */
export function requireAdmin(ctx: AuthContext): void {
  if (!['admin', 'superadmin'].includes(ctx.role)) {
    throw new AuthError(403, 'Accès réservé aux administrateurs');
  }
}

/** Vérifie que city_id demandé correspond au city_id du token — jamais confier au client */
export function assertCityAccess(ctx: AuthContext, requestedCityId: string): void {
  if (ctx.role !== 'superadmin' && ctx.cityId !== requestedCityId) {
    throw new AuthError(403, `Accès refusé à la ville ${requestedCityId}`);
  }
}

/** Crée une réponse d'erreur normalisée depuis une AuthError */
export function authErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ success: false, error: err.code, message: err.message }, { status: err.status });
  }
  return NextResponse.json({ success: false, error: 'server_error', message: 'Erreur interne' }, { status: 500 });
}

export class AuthError extends Error {
  constructor(public status: 401 | 403 | 500, message: string) {
    super(message);
    this.code = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'server_error';
  }
  code: string;
}
