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

const ACTIVE_RUN_STATUSES = new Set([
  "pending",
  "queued",
  "dispatching",
  "dispatched",
  "running",
  "awaiting_approval",
  "awaiting_review",
]);

const HISTORICAL_DUPLICATE_PATTERN = /(?:audit\s+nova\s*:\s*)?doublon\b.*(?:tache\s+canonique|sans\s+suppression)|exact_duplicate|semantic_duplicate|doublon\s+regroupe\s+avec\s+la\s+tache/i;
const INPUT_REQUIRED_PATTERN = /generation_video_incomplete|source_document_id|end_source_document_id|certaines_fiches_ne_peuvent_pas_etre_verifiees_automatiquement|source_ou_information_requise|media\s+source.*(?:absent|requis|manquant)|information(?:s)?\s+(?:necessaire|requise|manquante)/i;

export const normalizeTaskStatus = normalize;

export const isHistoricalDuplicate = (task = {}) => HISTORICAL_DUPLICATE_PATTERN.test(
  String(task?.notes || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
);

export const isTaskCompleted = (taskOrStatus) => {
  if (taskOrStatus?.operational_status) return taskOrStatus.operational_status === "DONE";
  const value = typeof taskOrStatus === "object" && taskOrStatus !== null
    ? taskOrStatus.statut ?? taskOrStatus.status
    : taskOrStatus;
  return COMPLETED_STATUSES.has(normalize(value));
};

export const isTaskBlocked = (taskOrStatus) => {
  if (taskOrStatus?.operational_status) return ["NO_EXECUTOR", "TECHNICAL_ERROR", "FAILED"].includes(taskOrStatus.operational_status);
  const value = typeof taskOrStatus === "object" && taskOrStatus !== null
    ? taskOrStatus.statut ?? taskOrStatus.status
    : taskOrStatus;
  return BLOCKED_STATUSES.has(normalize(value));
};

export function isStaleActiveRun(run, now = Date.now(), maxAgeMs = 48 * 60 * 60 * 1000) {
  if (!run || !ACTIVE_RUN_STATUSES.has(normalize(run.status))) return false;
  const timestamp = Date.parse(run.updated_at || run.created_at || run.started_at || "");
  return Number.isFinite(timestamp) && now - timestamp > maxAgeMs;
}

export function taskRequiresInput(task = {}, run = null) {
  if (isHistoricalDuplicate(task) || isTaskCompleted(task)) return false;
  const result = (() => {
    try { return JSON.stringify(run?.result || ""); } catch { return ""; }
  })();
  const text = [
    task?.notes,
    task?.description,
    run?.error,
    result,
  ].filter(Boolean).join("\n").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return INPUT_REQUIRED_PATTERN.test(text);
}

export function runOperationalStatus(run, options = {}) {
  if (!run) return null;
  if (isStaleActiveRun(run, options.now ?? Date.now(), options.maxAgeMs ?? 48 * 60 * 60 * 1000)) return "WAITING_INPUT";
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
  return task?.operational_status ? ["RUNNING", "RETRYING"].includes(task.operational_status)
    : normalize(task?.statut ?? task?.status) === "en_cours";
}

export function taskBlockerMessage(reason) {
  return ({
    ancienne_reservation_domaine_sans_dispatch: "Ancienne demande sans exécuteur de correction raccordé ; aucune nouvelle exécution lancée.",
    attente_confirmation_execution_agent: "En attente du retour de l’agent ; le démarrage du traitement n’est pas confirmé.",
    source_ou_information_requise: "Source média ou informations nécessaires à compléter.",
    correction_repertoire_interne_a_executer: "Diagnostic disponible ; exécuteur de correction du dépôt non raccordé.",
    plusieurs_runs_actifs_sur_un_objectif_regroupe: "Plusieurs exécutions déclarées actives pour cet objectif ; relance suspendue.",
    reservation_ancienne_a_relancer: "Ancienne exécution conservée pour traçabilité ; une information ou une relance contrôlée est requise.",
  })[reason] || reason || "Exécuteur indisponible";
}
