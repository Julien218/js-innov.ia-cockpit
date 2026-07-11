/**
 * Logger d'actions — automatique, indépendant des instructions de l'agent.
 * Chaque run, tool call, interruption, validation et exécution est enregistré ici
 * sans dépendre d'une consigne donnée au modèle LLM.
 */
import { supabaseAdmin } from './supabase';
import type { AiActionLog, ActionStatus, RiskLevel } from './types';

export interface LogRunOpts {
  cityId: string;
  agentName: string;
  actionType: string;
  entityType: string;
  entityId?: string;
  inputSummary: string;
  riskLevel?: RiskLevel;
  metadata?: Record<string, unknown>;
}

export interface LogInterruptionOpts {
  actionLogId: string;
  runId: string;
  runStateSerialized: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
  riskLevel: RiskLevel;
}

/** Crée un log d'action en status=draft au démarrage d'un run */
export async function logRunStart(opts: LogRunOpts): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('ai_action_logs')
    .insert({
      city_id: opts.cityId,
      status: 'draft' as ActionStatus,
      action_type: opts.actionType,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      agent_name: opts.agentName,
      input_summary: opts.inputSummary,
      risk_level: opts.riskLevel ?? 'low',
      metadata: opts.metadata ?? {},
    })
    .select('id')
    .single();
  if (error) throw new Error(`[logger] logRunStart: ${error.message}`);
  return data.id;
}

/** Marque un log d'action comme terminé avec succès */
export async function logRunSuccess(actionLogId: string, outputSummary: string, tokensUsed?: number, durationMs?: number): Promise<void> {
  await supabaseAdmin.from('ai_action_logs').update({
    status: 'succeeded' as ActionStatus,
    output_summary: outputSummary,
    tokens_used: tokensUsed ?? null,
    duration_ms: durationMs ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', actionLogId);
}

/** Marque un log d'action comme échoué */
export async function logRunError(actionLogId: string, errorMessage: string): Promise<void> {
  await supabaseAdmin.from('ai_action_logs').update({
    status: 'failed' as ActionStatus,
    output_summary: `ERREUR: ${errorMessage}`,
    updated_at: new Date().toISOString(),
  }).eq('id', actionLogId);
}

/** Enregistre une interruption HITL avec le RunState sérialisé pour reprise */
export async function logInterruption(opts: LogInterruptionOpts): Promise<void> {
  await supabaseAdmin.from('ai_action_logs').update({
    status: 'pending_validation' as ActionStatus,
    run_id: opts.runId,
    run_state: { serialized: opts.runStateSerialized, created_at: new Date().toISOString(), agent_name: 'VilleConnect Copilot' },
    interruption_data: {
      tool_name: opts.toolName,
      tool_input: opts.toolInput,
      description: opts.description,
      risk_level: opts.riskLevel,
    },
    updated_at: new Date().toISOString(),
  }).eq('id', opts.actionLogId);
}

/** Enregistre une décision de validation (approved/rejected) */
export async function logValidationDecision(
  actionLogId: string,
  decision: 'approved' | 'rejected',
  validatedBy: string,
  rejectionReason?: string
): Promise<void> {
  await supabaseAdmin.from('ai_action_logs').update({
    status: decision === 'approved' ? 'approved' : 'rejected',
    validated_by: validatedBy,
    validated_at: new Date().toISOString(),
    rejection_reason: rejectionReason ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', actionLogId);
}
