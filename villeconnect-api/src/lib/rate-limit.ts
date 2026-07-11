/**
 * Rate limiting basé sur Supabase — pas de Redis requis.
 * Par user_id : 30 req/min. Par city_id : 500 req/min.
 */
import { supabaseAdmin } from './supabase';

const WINDOW_SECONDS = 60;
const USER_LIMIT     = 30;
const CITY_LIMIT     = 500;

interface RateLimitRecord {
  key: string;
  count: number;
  window_start: string;
}

async function checkLimit(key: string, limit: number): Promise<{ allowed: boolean; remaining: number }> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (WINDOW_SECONDS * 1000)) * WINDOW_SECONDS * 1000);

  const { data, error } = await supabaseAdmin
    .from('vc_rate_limits')
    .upsert({ key, count: 1, window_start: windowStart.toISOString() }, {
      onConflict: 'key,window_start',
      ignoreDuplicates: false,
    })
    .select('count')
    .single();

  if (error) {
    // En cas d'erreur sur la table de rate-limit, on laisse passer (fail open)
    console.warn('[rate-limit] Erreur:', error.message);
    return { allowed: true, remaining: limit };
  }

  const count = (data as RateLimitRecord)?.count ?? 1;
  await supabaseAdmin.rpc('increment_rate_limit', { p_key: key, p_window_start: windowStart.toISOString() });

  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function checkRateLimits(userId: string, cityId: string): Promise<{ allowed: boolean; reason?: string }> {
  const [userCheck, cityCheck] = await Promise.all([
    checkLimit(`user:${userId}`, USER_LIMIT),
    checkLimit(`city:${cityId}`, CITY_LIMIT),
  ]);
  if (!userCheck.allowed) return { allowed: false, reason: `Limite utilisateur atteinte (${USER_LIMIT}/min)` };
  if (!cityCheck.allowed) return { allowed: false, reason: `Limite ville atteinte (${CITY_LIMIT}/min)` };
  return { allowed: true };
}
