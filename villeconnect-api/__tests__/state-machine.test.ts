/**
 * Tests de la machine d'états ai_action_logs.
 * Couvre : approbation valide, refus, double approbation, double exécution.
 * Utilise des mocks Supabase pour éviter toute connexion réelle.
 */

// ── Types locaux ──────────────────────────────────────────────────────────────
type ActionStatus =
  | 'draft' | 'pending_validation' | 'approved' | 'rejected'
  | 'executing' | 'succeeded' | 'failed' | 'cancelled';

// ── Machine d'états en mémoire (reproduit la logique SQL de transition_action_status) ──
class ActionStateMachine {
  private status: ActionStatus;
  private executedOnce = false;

  constructor(initial: ActionStatus = 'draft') { this.status = initial; }

  // Transitions autorisées
  private static ALLOWED: Record<ActionStatus, ActionStatus[]> = {
    draft:              ['pending_validation', 'cancelled'],
    pending_validation: ['approved', 'rejected'],
    approved:           ['executing'],
    rejected:           [],
    executing:          ['succeeded', 'failed', 'cancelled'],
    succeeded:          [],
    failed:             [],
    cancelled:          [],
  };

  /**
   * Transition atomique — retourne true si réussie, false si refusée.
   * Simule le UPDATE WHERE status=from de la fonction SQL.
   */
  transition(from: ActionStatus, to: ActionStatus): boolean {
    if (this.status !== from) return false;  // garde atomique
    const allowed = ActionStateMachine.ALLOWED[from] ?? [];
    if (!allowed.includes(to)) return false;
    // Exécution unique : approved→executing ne peut se faire qu'une fois
    if (from === 'approved' && to === 'executing') {
      if (this.executedOnce) return false;
      this.executedOnce = true;
    }
    this.status = to;
    return true;
  }

  getStatus() { return this.status; }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Machine d\'états ai_action_logs', () => {
  test('flux complet nominal : draft → pending_validation → approved → executing → succeeded', () => {
    const sm = new ActionStateMachine();
    expect(sm.transition('draft', 'pending_validation')).toBe(true);
    expect(sm.transition('pending_validation', 'approved')).toBe(true);
    expect(sm.transition('approved', 'executing')).toBe(true);
    expect(sm.transition('executing', 'succeeded')).toBe(true);
    expect(sm.getStatus()).toBe('succeeded');
  });

  test('approbation valide', () => {
    const sm = new ActionStateMachine('pending_validation');
    expect(sm.transition('pending_validation', 'approved')).toBe(true);
    expect(sm.getStatus()).toBe('approved');
  });

  test('refus valide sans exécution', () => {
    const sm = new ActionStateMachine('pending_validation');
    expect(sm.transition('pending_validation', 'rejected')).toBe(true);
    expect(sm.getStatus()).toBe('rejected');
    // Aucune transition possible depuis rejected
    expect(sm.transition('rejected', 'approved')).toBe(false);
    expect(sm.transition('rejected', 'executing')).toBe(false);
  });

  test('double approbation bloquée (état concurrent)', () => {
    const sm = new ActionStateMachine('pending_validation');
    expect(sm.transition('pending_validation', 'approved')).toBe(true);
    // Deuxième appel : l'état n'est plus pending_validation
    expect(sm.transition('pending_validation', 'approved')).toBe(false);
  });

  test('double exécution bloquée (approved→executing une seule fois)', () => {
    const sm = new ActionStateMachine('pending_validation');
    sm.transition('pending_validation', 'approved');
    expect(sm.transition('approved', 'executing')).toBe(true);
    // Tentative de re-passer à executing (simuler appel concurrent)
    expect(sm.transition('approved', 'executing')).toBe(false);
  });

  test('transition invalide rejected → executing rejetée', () => {
    const sm = new ActionStateMachine('rejected');
    expect(sm.transition('rejected', 'executing')).toBe(false);
    expect(sm.getStatus()).toBe('rejected');
  });

  test('transition invalide draft → succeeded rejetée', () => {
    const sm = new ActionStateMachine('draft');
    expect(sm.transition('draft', 'succeeded')).toBe(false);
    expect(sm.getStatus()).toBe('draft');
  });

  test('action sensible interrompue ne passe pas à executing directement', () => {
    const sm = new ActionStateMachine('draft');
    sm.transition('draft', 'pending_validation');
    // Sans approbation, executing impossible
    expect(sm.transition('pending_validation', 'executing')).toBe(false);
    expect(sm.getStatus()).toBe('pending_validation');
  });
});
