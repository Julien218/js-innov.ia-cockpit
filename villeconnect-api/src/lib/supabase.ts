/**
 * Client Supabase — SERVEUR UNIQUEMENT
 * Le service_role bypass la RLS. Ne jamais exporter cote frontend.
 *
 * Validation au RUNTIME uniquement :
 * - En mode CI (build Next.js), les vars peuvent etre factices
 *   → le createClient reussit avec des valeurs syntaxiquement valides
 * - Au runtime reel, les vars doivent etre les vraies valeurs Supabase
 * - Pour les tests unitaires, jest.setup.ts injecte des valeurs factices
 *
 * La validation stricte (throw) est dans validateRuntimeEnv() appelee
 * depuis le premier handler de requete, pas au module load.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Fallbacks syntaxiquement valides pour le build Next.js (build-time uniquement)
// Ces valeurs ne permettent aucun appel Supabase reel.
const BUILD_TIME_URL = 'https://build-placeholder.supabase.co';
const BUILD_TIME_KEY = 'ci-build-placeholder.not-a-real-jwt.build-time-only';

const supabaseUrl     = process.env.SUPABASE_URL     ?? BUILD_TIME_URL;
const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? BUILD_TIME_KEY;

/**
 * Client admin (service_role) — contourne la RLS.
 * Verifie toujours l'appartenance ville AVANT d'appeler ce client.
 */
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'X-Client-Info': 'villeconnect-api/2.0' },
  },
});

/**
 * Validation au RUNTIME (a appeler depuis le premier handler, pas a l'import).
 * Lance une erreur si les vraies vars ne sont pas configurees.
 */
export function validateRuntimeEnv(): void {
  if (
    !process.env.SUPABASE_URL ||
    process.env.SUPABASE_URL === BUILD_TIME_URL
  ) {
    throw new Error('[supabase] SUPABASE_URL manquante ou placeholder — configurer en production');
  }
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === BUILD_TIME_KEY
  ) {
    throw new Error('[supabase] SUPABASE_SERVICE_ROLE_KEY manquante ou placeholder — configurer en production');
  }
}

/**
 * transitionActionStatus — UPDATE atomique WHERE status = from_status.
 * Retourne true si la transition a reellement eu lieu (1 ligne mise a jour).
 * Retourne false si l'etat courant != from_status (transition concurrente detectee).
 */
export async function transitionActionStatus(
  actionLogId: string,
  fromStatus: string,
  toStatus: string,
  meta?: Record<string, unknown>,
): Promise<boolean> {
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    status: toStatus,
    updated_at: now,
    ...meta,
  };

  const { data, error } = await supabaseAdmin
    .from('ai_action_logs')
    .update(updateData)
    .eq('id', actionLogId)
    .eq('status', fromStatus)   // garde atomique
    .select('id');

  if (error) {
    console.error('[supabase] transitionActionStatus erreur:', error.message);
    return false;
  }

  return Array.isArray(data) && data.length === 1;
}
