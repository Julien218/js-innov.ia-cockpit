/**
 * VilleConnect Copilot — Agent principal avec HITL réel (@openai/agents-core 0.13.x)
 *
 * HITL via needsApproval=true :
 *  1. run() exécute l'agent
 *  2. Si un outil needsApproval est appelé, result.interruptions contient RunToolApprovalItem[]
 *  3. result.state.toJSON() sérialise le RunState → stocké dans ai_action_logs.run_state
 *  4. Après validation, /api/validate-action appelle resumeAgentAfterApproval()
 *     qui repart depuis le RunState désérialisé via run(agent, restoredState)
 *
 * pending_validation est calculé depuis result.interruptions.length > 0 — JAMAIS hardcodé.
 */
import { Agent, run } from '@openai/agents-core';
import { ALL_TOOLS } from './tools';
import type { AgentServerContext } from './server-context';
import { logRunStart, logRunSuccess, logRunError, logInterruption } from '@/lib/action-logger';

export interface AgentRunResult {
  response: string;
  pendingValidation: boolean;
  interruption?: { toolName: string; toolInput: Record<string, unknown>; description: string };
  tokensUsed?: number;
}

const AGENT_INSTRUCTIONS = `Tu es VilleConnect Copilot, l'assistant IA municipal.
Tu as accès aux informations de la ville via tes outils. Tu peux :
- Répondre aux questions des citoyens et agents
- Créer des brouillons d'annonces et de tâches
- Proposer des actions (publication, notification) via les outils request_* (validation humaine requise)

RÈGLES :
- Utilise les outils request_* pour toute action sensible — cela déclenchera une validation humaine.
- Ne révèle jamais d'informations techniques (city_id, clés, etc.).
- Réponds toujours en français, concis et bienveillant.`;

let _agent: Agent | null = null;
function getAgent(): Agent {
  if (!_agent) _agent = new Agent({ name: 'VilleConnect Copilot', model: 'gpt-4o', instructions: AGENT_INSTRUCTIONS, tools: ALL_TOOLS });
  return _agent;
}

export async function runAgent(message: string, serverCtx: AgentServerContext): Promise<AgentRunResult> {
  const start = Date.now();
  await logRunStart({
    cityId: serverCtx.auth.cityId, agentName: 'VilleConnect Copilot',
    actionType: 'chat_message', entityType: 'conversation', entityId: serverCtx.conversationId,
    inputSummary: message.slice(0, 200), riskLevel: 'low',
    metadata: { action_log_id: serverCtx.actionLogId },
  });

  try {
    const result = await run(getAgent(), message, { context: serverCtx });
    const durationMs = Date.now() - start;

    // HITL : interruptions[] est calculé depuis le SDK, jamais depuis le prompt
    const interruptions = result.interruptions ?? [];

    if (interruptions.length > 0) {
      const interrupt = interruptions[0];
      // Sérialise le RunState pour reprise après validation humaine
      const runStateSerialized = JSON.stringify(result.state.toJSON());
      const rawArgs = (interrupt as unknown as { rawItem?: { arguments?: string } }).rawItem?.arguments ?? '{}';
      const toolInput = JSON.parse(rawArgs) as Record<string, unknown>;

      await logInterruption({
        actionLogId: serverCtx.actionLogId,
        runId: `run-${Date.now()}`,
        runStateSerialized,
        toolName: interrupt.toolName ?? 'unknown',
        toolInput,
        description: 'Outil requiert validation humaine',
        riskLevel: 'high',
      });

      return {
        response: 'Une action a ete preparee et necessite votre validation dans le cockpit.',
        pendingValidation: true,   // calculé depuis interruptions.length > 0
        interruption: { toolName: interrupt.toolName ?? 'unknown', toolInput, description: `Action en attente: ${interrupt.toolName}` },
      };
    }

    const output = (result as unknown as { finalOutput?: string }).finalOutput ?? 'Désolé, je n\'ai pas pu traiter votre demande.';
    await logRunSuccess(serverCtx.actionLogId, output.slice(0, 500), undefined, durationMs);
    return { response: output, pendingValidation: false };
  } catch (err) {
    await logRunError(serverCtx.actionLogId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function resumeAgentAfterApproval(serializedRunState: string, serverCtx: AgentServerContext): Promise<AgentRunResult> {
  const start = Date.now();
  try {
    // Désérialise le RunState depuis la chaîne stockée en DB
    const parsedState = JSON.parse(serializedRunState);
    const result = await run(getAgent(), parsedState, { context: serverCtx });
    const durationMs = Date.now() - start;
    const output = (result as unknown as { finalOutput?: string }).finalOutput ?? 'Action exécutée.';
    await logRunSuccess(serverCtx.actionLogId, output.slice(0, 500), undefined, durationMs);
    return { response: output, pendingValidation: false };
  } catch (err) {
    await logRunError(serverCtx.actionLogId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
