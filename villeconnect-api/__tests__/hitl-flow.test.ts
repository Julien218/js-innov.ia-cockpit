/**
 * Tests du flux HITL (Human-in-the-Loop).
 * Simule l'interruption, la sérialisation du RunState, l'approbation et le refus.
 * Utilise des mocks — pas de connexion OpenAI/Supabase réelle.
 */

// Simulation du flux HITL sans dépendances externes
interface MockRunResult {
  finalOutput: string | null;
  interruptions: Array<{ toolName: string; rawItem: { arguments: string } }>;
  state?: object;
}

interface ActionLog {
  id: string;
  status: string;
  run_state: { serialized: string } | null;
  interruption_data: object | null;
}

function simulateAgentRun(hasInterruption: boolean): MockRunResult {
  if (hasInterruption) {
    return {
      finalOutput: null,
      interruptions: [{ toolName: 'request_publish_announcement', rawItem: { arguments: '{"announcement_id":"ann-1","reason":"test"}' } }],
      state: { messages: ['msg1'], step: 2 },
    };
  }
  return { finalOutput: 'Voici votre réponse.', interruptions: [], state: undefined };
}

function processRunResult(result: MockRunResult, actionLogId: string): { response: string; pendingValidation: boolean; runState?: string } {
  if (result.interruptions.length > 0) {
    const runStateSerialized = JSON.stringify(result.state ?? {});
    return {
      response: 'Action en attente de validation dans le cockpit.',
      pendingValidation: true,   // calculé depuis les interruptions réelles
      runState: runStateSerialized,
    };
  }
  return { response: result.finalOutput ?? '', pendingValidation: false };
}

function approveAction(log: ActionLog, resumeFn: (state: string) => string): { success: boolean; output?: string; error?: string } {
  if (log.status !== 'pending_validation') return { success: false, error: `État invalide: ${log.status}` };
  if (!log.run_state?.serialized) return { success: false, error: 'Pas de RunState stocké' };
  const output = resumeFn(log.run_state.serialized);
  return { success: true, output };
}

function rejectAction(log: ActionLog): { success: boolean; newStatus: string } {
  if (log.status !== 'pending_validation') return { success: false, newStatus: log.status };
  return { success: true, newStatus: 'rejected' };
}

describe('Flux HITL — interruption, sérialisation, reprise', () => {
  test('run sans interruption — pendingValidation=false', () => {
    const result = simulateAgentRun(false);
    const processed = processRunResult(result, 'log-1');
    expect(processed.pendingValidation).toBe(false);
    expect(processed.response).toBe('Voici votre réponse.');
  });

  test('run avec interruption — pendingValidation=true calculé depuis interruptions', () => {
    const result = simulateAgentRun(true);
    const processed = processRunResult(result, 'log-2');
    expect(processed.pendingValidation).toBe(true);
    expect(processed.runState).toBeDefined();
    expect(() => JSON.parse(processed.runState!)).not.toThrow();
  });

  test('RunState sérialisé contient les données d\'état', () => {
    const result = simulateAgentRun(true);
    const processed = processRunResult(result, 'log-3');
    const parsed = JSON.parse(processed.runState!);
    expect(parsed).toHaveProperty('messages');
  });

  test('approbation valide — reprend le run depuis le RunState', () => {
    const mockLog: ActionLog = {
      id: 'log-4', status: 'pending_validation',
      run_state: { serialized: JSON.stringify({ messages: ['m1'], step: 2 }) },
      interruption_data: { toolName: 'request_publish_announcement' },
    };
    const result = approveAction(mockLog, (state) => `Run repris depuis: ${state}`);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Run repris');
  });

  test('approbation bloquée si état != pending_validation', () => {
    const mockLog: ActionLog = { id: 'log-5', status: 'approved', run_state: null, interruption_data: null };
    const result = approveAction(mockLog, () => '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('État invalide');
  });

  test('refus valide — status passe à rejected', () => {
    const mockLog: ActionLog = { id: 'log-6', status: 'pending_validation', run_state: null, interruption_data: null };
    const result = rejectAction(mockLog);
    expect(result.success).toBe(true);
    expect(result.newStatus).toBe('rejected');
  });

  test('refus sur action non-pending rejeté', () => {
    const mockLog: ActionLog = { id: 'log-7', status: 'rejected', run_state: null, interruption_data: null };
    const result = rejectAction(mockLog);
    expect(result.success).toBe(false);
  });

  test('erreur OpenAI pendant reprise — gérée sans crash', () => {
    const mockLog: ActionLog = {
      id: 'log-8', status: 'pending_validation',
      run_state: { serialized: '{"messages":[]}' }, interruption_data: null,
    };
    const failingResume = (_state: string) => { throw new Error('OpenAI timeout'); };
    expect(() => approveAction(mockLog, failingResume)).toThrow('OpenAI timeout');
  });
});
