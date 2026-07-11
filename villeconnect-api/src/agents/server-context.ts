/**
 * Contexte serveur typé pour les agents.
 * city_id, userId et role NE sont JAMAIS injectés dans le prompt —
 * ils sont passés via ce contexte serveur vérifié côté backend.
 */
import type { AuthContext } from '@/lib/types';
import type { VcCity } from '@/lib/types';

export interface AgentServerContext {
  auth: AuthContext;             // vérifié depuis le JWT
  city: VcCity;                  // chargé depuis Supabase, pas depuis le client
  conversationId: string;
  actionLogId: string;           // log pré-créé par le backend avant de lancer l'agent
  startedAt: number;             // performance.now()
}
