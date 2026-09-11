const normalize = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[\s-]+/g, "_");

const COMPLETED_STATUSES = new Set([
  "termine",
  "terminee",
  "complete",
  "completed",
  "done",
  "closed",
  "cloture",
  "cloturee",
  "success",
  "succeeded",
]);

const BLOCKED_STATUSES = new Set([
  "bloque",
  "bloquee",
  "blocked",
  "failed",
  "error",
  "erreur",
]);

export const normalizeTaskStatus = normalize;

export const isTaskCompleted = (taskOrStatus) => {
  if (taskOrStatus?.operational_status) return taskOrStatus.operational_status === "DONE";
  const value = typeof taskOrStatus === "object" && taskOrStatus !== null
    ? taskOrStatus.statut ?? taskOrStatus.status
    : taskOrStatus;
  return COMPLETED_STATUSES.has(normalize(value));
};

export const isTaskBlocked = (taskOrStatus) => {
  if (taskOrStatus?.operational_status) return ["NO_EXECUTOR", "TECHNICAL_ERROR", "FAILED", "WAITING_INPUT"].includes(taskOrStatus.operational_status);
  const value = typeof taskOrStatus === "object" && taskOrStatus !== null
    ? taskOrStatus.statut ?? taskOrStatus.status
    : taskOrStatus;
  return BLOCKED_STATUSES.has(normalize(value));
};


export function runOperationalStatus(run) {
  if (!run) return null;
  if (run.status === "completed") return run.proof_status === "verified" && run.has_evidence && run.completed_at ? "DONE" : "TECHNICAL_ERROR";
  if (["WAITING_AUTHORIZATION", "WAITING_INPUT", "RUNNING", "RETRYING", "NO_EXECUTOR", "TECHNICAL_ERROR", "FAILED"].includes(run.operational_status)) return run.operational_status;
  if (run.status === "awaiting_approval") return "WAITING_AUTHORIZATION";
  if (run.status === "awaiting_review") return "WAITING_INPUT";
  if (run.status === "running") return "RUNNING";
  if (["pending", "queued", "dispatching", "dispatched"].includes(run.status)) return "WAITING_INPUT";
  if (run.status === "failed") return "FAILED";
  return null;
}

export function isTaskInProgress(task) {
  return task?.operational_status ? ['RUNNING', 'RETRYING'].includes(task.operational_status)
    : normalize(task?.statut ?? task?.status) === 'en_cours';
}

export function taskBlockerMessage(reason) {
  return ({
    ancienne_reservation_domaine_sans_dispatch: 'Ancienne demande sans exécuteur de correction raccordé ; aucune nouvelle exécution lancée.',
    attente_confirmation_execution_agent: 'En attente du retour de l’agent ; le démarrage du traitement n’est pas confirmé.',
    source_ou_information_requise: 'Source média ou informations nécessaires à compléter.',
    correction_repertoire_interne_a_executer: 'Diagnostic disponible ; exécuteur de correction du dépôt non raccordé.',
    plusieurs_runs_actifs_sur_un_objectif_regroupe: 'Plusieurs exécutions déclarées actives pour cet objectif ; relance suspendue.',
  })[reason] || reason || 'Exécuteur indisponible';
}
