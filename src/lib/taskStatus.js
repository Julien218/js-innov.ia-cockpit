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

