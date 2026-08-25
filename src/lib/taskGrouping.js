import { isTaskBlocked, isTaskCompleted, normalizeTaskStatus } from "./taskStatus.js";

const normalizeKey = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function taskGroupKey(task = {}) {
  return [
    normalizeKey(task.titre || task.title),
    normalizeKey(task.client_id || task.client_nom),
    normalizeKey(task.projet_id || task.projet_nom),
  ].join("|");
}

function taskStateRank(task) {
  const status = normalizeTaskStatus(task?.statut ?? task?.status);
  if (status === "en_cours") return 0;
  if (isTaskBlocked(task)) return 1;
  if (!isTaskCompleted(task)) return 2;
  return 3;
}

function taskTimestamp(task) {
  return new Date(task?.updated_at || task?.created_at || task?.created_date || 0).getTime() || 0;
}

export function groupTasks(tasks = []) {
  const groups = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const key = taskGroupKey(task) || `id:${task?.id || groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }

  return [...groups.values()].map((copies) => {
    const ordered = copies.slice().sort((a, b) => taskStateRank(a) - taskStateRank(b) || taskTimestamp(b) - taskTimestamp(a));
    const primary = ordered[0];
    return {
      ...primary,
      duplicate_count: copies.length,
      duplicate_ids: copies.map((task) => task.id).filter(Boolean),
      duplicate_tasks: copies,
      _search_text: copies.flatMap((task) => [task.titre, task.description, task.client_nom, task.projet_nom]).filter(Boolean).join(" "),
    };
  });
}
