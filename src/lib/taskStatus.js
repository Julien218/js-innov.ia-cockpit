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
  const value = typeof taskOrStatus === "object" && taskOrStatus !== null
    ? taskOrStatus.statut ?? taskOrStatus.status
    : taskOrStatus;
  return COMPLETED_STATUSES.has(normalize(value));
};

export const isTaskBlocked = (taskOrStatus) => {
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
  if (["pending", "queued", "dispatching", "dispatched", "running"].includes(run.status)) return "RUNNING";
  if (run.status === "failed") return "FAILED";
  return null;
}
