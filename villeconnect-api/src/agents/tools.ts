/**
 * Outils VilleConnect — 3 catégories séparées :
 *  1. LECTURE       : pas d'effet externe, toujours exécutés
 *  2. BROUILLONS    : créent en DB avec status=draft uniquement
 *  3. ACTIONS HITL  : needsApproval=true → interrompent le run pour validation humaine
 */
import { tool } from '@openai/agents-core';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper pour extraire le contexte serveur depuis runContext
function extractCtx(rc: unknown): { cityId: string; userId: string } {
  const ctx = (rc as { context?: { auth?: { cityId?: string; userId?: string } } })?.context?.auth;
  return { cityId: ctx?.cityId ?? '', userId: ctx?.userId ?? '' };
}

// ══════════════════════════════════════
// CATÉGORIE 1 — LECTURE
// ══════════════════════════════════════
export const getCityInfo = tool({
  name: 'get_city_info',
  description: 'Lit les informations de la ville courante. Lecture seule.',
  parameters: z.object({ include_stats: z.boolean().default(false) }),
  execute: async ({ include_stats }, rc) => {
    const { cityId } = extractCtx(rc);
    const { data: city, error } = await supabaseAdmin.from('vc_cities').select('*').eq('id', cityId).single();
    if (error) throw new Error(`Ville introuvable: ${error.message}`);
    if (!include_stats) return city;
    const [ann, bugs] = await Promise.all([
      supabaseAdmin.from('vc_announcements').select('id', { count: 'exact' }).eq('city_id', cityId).eq('status', 'pending_validation'),
      supabaseAdmin.from('vc_bug_reports').select('id', { count: 'exact' }).eq('city_id', cityId).in('status', ['open', 'triaged']),
    ]);
    return { ...city, stats: { pending_announcements: ann.count, open_bugs: bugs.count } };
  },
});

export const searchCityMemory = tool({
  name: 'search_city_memory',
  description: 'Recherche sémantique (RAG) dans la mémoire de la ville. Lecture seule.',
  parameters: z.object({ query: z.string(), threshold: z.number().min(0).max(1).default(0.7), limit: z.number().min(1).max(10).default(5) }),
  execute: async ({ query, threshold, limit }, rc) => {
    const { cityId } = extractCtx(rc);
    const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query });
    const { data, error } = await supabaseAdmin.rpc('match_memory_vectors', { query_embedding: emb.data[0].embedding, city_id_filter: cityId, match_threshold: threshold, match_count: limit });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
});

// ══════════════════════════════════════════
// CATÉGORIE 2 — BROUILLONS
// ══════════════════════════════════════════
export const createAnnouncementDraft = tool({
  name: 'create_announcement_draft',
  description: 'Crée un brouillon d\'annonce (status=draft). Ne publie JAMAIS directement.',
  parameters: z.object({
    title: z.string().min(5).max(200),
    content: z.string().min(20).max(5000),
    category: z.enum(['info', 'event', 'alert', 'commercial']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    ai_reasoning: z.string(),
  }),
  execute: async ({ title, content, category, priority, ai_reasoning }, rc) => {
    const { cityId, userId } = extractCtx(rc);
    const { data, error } = await supabaseAdmin.from('vc_announcements').insert({
      city_id: cityId, author_id: userId, title, content, category, priority,
      status: 'draft', ai_generated: true,
      ai_draft: { reasoning: ai_reasoning, suggested_at: new Date().toISOString() },
    }).select('id').single();
    if (error) throw new Error(error.message);
    return { announcement_id: data.id, status: 'draft', message: 'Brouillon créé. Validation humaine requise avant publication.' };
  },
});

export const createTaskDraft = tool({
  name: 'create_task_draft',
  description: 'Crée une tâche interne (ai_suggested=true).',
  parameters: z.object({
    title: z.string().min(5).max(200), description: z.string().optional(),
    category: z.enum(['content', 'technical', 'admin', 'communication', 'legal']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
  }),
  execute: async (params, rc) => {
    const { cityId, userId } = extractCtx(rc);
    const { data, error } = await supabaseAdmin.from('vc_tasks').insert({ city_id: cityId, created_by: userId, ...params, status: 'todo', ai_suggested: true }).select('id').single();
    if (error) throw new Error(error.message);
    return { task_id: data.id };
  },
});

// ══════════════════════════════════════════════════════════════
// CATÉGORIE 3 — ACTIONS HITL (needsApproval=true)
// Le run s'interrompt ici → stockage RunState → validation cockpit
// ══════════════════════════════════════════════════════════════
export const requestPublishAnnouncement = tool({
  name: 'request_publish_announcement',
  description: 'Demande la publication d\'une annonce. REQUIERT VALIDATION HUMAINE.',
  parameters: z.object({ announcement_id: z.string().uuid(), reason: z.string() }),
  needsApproval: async () => true,   // toujours needsApproval pour les actions sensibles
  execute: async ({ announcement_id }, rc) => {
    const { cityId } = extractCtx(rc);
    const { data, error } = await supabaseAdmin.from('vc_announcements').select('id,title').eq('id', announcement_id).eq('city_id', cityId).single();
    if (error || !data) throw new Error('Annonce introuvable ou hors de votre ville');
    await supabaseAdmin.from('vc_announcements').update({ status: 'pending_validation', updated_at: new Date().toISOString() }).eq('id', announcement_id);
    return { announcement_id, title: data.title, status: 'pending_validation' };
  },
});

export const requestActivateCampaign = tool({
  name: 'request_activate_campaign',
  description: 'Demande l\'activation d\'une campagne. REQUIERT VALIDATION HUMAINE.',
  parameters: z.object({ campaign_id: z.string().uuid(), reason: z.string() }),
  needsApproval: async () => true,
  execute: async ({ campaign_id }, rc) => {
    const { cityId } = extractCtx(rc);
    const { data, error } = await supabaseAdmin.from('vc_campaigns').select('id,name').eq('id', campaign_id).eq('city_id', cityId).single();
    if (error || !data) throw new Error('Campagne introuvable ou hors de votre ville');
    await supabaseAdmin.from('vc_campaigns').update({ status: 'pending_validation', updated_at: new Date().toISOString() }).eq('id', campaign_id);
    return { campaign_id, name: data.name, status: 'pending_validation' };
  },
});

export const requestSendNotification = tool({
  name: 'request_send_notification',
  description: 'Demande l\'envoi d\'une notification massive. REQUIERT VALIDATION HUMAINE.',
  parameters: z.object({ message: z.string().max(500), channels: z.array(z.enum(['push','email','telegram','whatsapp'])), reason: z.string() }),
  needsApproval: async () => true,
  execute: async (params) => ({ status: 'pending_validation', payload: params }),
});

export const READ_TOOLS  = [getCityInfo, searchCityMemory];
export const DRAFT_TOOLS = [createAnnouncementDraft, createTaskDraft];
export const HITL_TOOLS  = [requestPublishAnnouncement, requestActivateCampaign, requestSendNotification];
export const ALL_TOOLS   = [...READ_TOOLS, ...DRAFT_TOOLS, ...HITL_TOOLS];
