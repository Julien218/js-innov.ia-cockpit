/**
 * Rate limiting via vc_rate_limits (Supabase).
 * Mode FAIL CLOSED : si la table est indisponible, la requete est bloquee.
 * Par user_id : 30 req/min. Par city_id : 500 req/min.
 *
 * Changement v2 : suppression du fail-open. Une erreur DB retourne
 * { allowed: false, reason: 'service_unavailable' } au lieu de laisser passer.
 */
import { supabaseAdmin } from './supabase';

const WINDOW_SECONDS = 60;
const USER_LIMIT     = 30;
const CITY_LIMIT     = 500;

async function checkAndIncrement(
  key: string,
  limit: number,
): Promise<{ allowed: boolean; remaining: number; error?: string }> {
  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / (WINDOW_SECONDS * 1000)) * WINDOW_SECONDS * 1000,
  );

  // Appel atomique : INSERT ... ON CONFLICT DO UPDATE, retourne le nouveau count
  const { data, error } = await supabaseAdmin
    .rpc('increment_rate_limit', {
      p_key:          key,
      p_window_start: windowStart.toISOString(),
    });

  if (error) {
    // FAIL CLOSED : table indisponible → requete bloquee
    console.error('[rate-limit] Erreur RPC increment_rate_limit:', error.code, error.message);
    return { allowed: false, remaining: 0, error: 'service_unavailable' };
  }

  const count = (data as number) ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function checkRateLimits(
  userId: string,
  cityId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const [userResult, cityResult] = await Promise.all([
    checkAndIncrement(`user:${userId}`, USER_LIMIT),
    checkAndIncrement(`city:${cityId}`, CITY_LIMIT),
  ]);

  if (userResult.error || cityResult.error) {
    return { allowed: false, reason: 'Service de rate-limiting indisponible' };
  }
  if (!userResult.allowed) {
    return { allowed: false, reason: `Limite utilisateur atteinte (${USER_LIMIT}/min)` };
  }
  if (!cityResult.allowed) {
    return { allowed: false, reason: `Limite ville atteinte (${CITY_LIMIT}/min)` };
  }
  return { allowed: true };
}
