"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function desktopStateFile() {
  try {
    const { app } = require("electron");
    return app?.getPath ? path.join(app.getPath("userData"), "elynea-actions", "receipts.json") : null;
  } catch { return null; }
}
function observedStatus(output) {
  if (!output || typeof output !== "object") return "unverified";
  const status = String(output.status || output.state || "").toLowerCase();
  if (output.ok === false || output.success === false || output.error || ["failed", "error", "cancelled", "canceled"].includes(status)) return "failed";
  if (["queued", "pending", "accepted", "running", "processing", "dispatched"].includes(status)) return status;
  if (output.delegated === true) return "delegated";
  if (status === "ready_to_execute") return status;
  if (output.ok === true || output.success === true || output.verified === true) return "completed";
  return "unverified";
}

function createJarvisExecutor({ routeJarvis, detectCapabilities, executeWeb, localAgentRequest, comfyRequest, audit, stateFile = desktopStateFile(), now = Date.now }) {
  const records = new Map();
  const inFlight = new Map();
  const retention = 24 * 60 * 60_000;
  let storageError = null;
  if (stateFile) {
    try {
      const entries = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (!Array.isArray(entries) || entries.length > 1000) throw new Error("Invalid action ledger");
      for (const item of entries) {
        if (!item || !/^[a-f0-9]{64}$/.test(item.key) || !/^[a-f0-9]{64}$/.test(item.fingerprint) || !item.executionId || !Number.isFinite(item.updatedAt)) throw new Error("Invalid action receipt");
        if (now() - item.updatedAt < retention) records.set(item.key, { ...item, status: item.status === "running" ? "reconciliation_required" : item.status });
      }
    } catch (error) { if (error.code !== "ENOENT") storageError = error; }
  }
  function persist() {
    if (!stateFile) return;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([...records.values()]), { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  }
  function receipt(item, extra = {}) {
    return {
      executionId: item.executionId, status: item.status, startedAt: item.startedAt,
      completedAt: item.completedAt || null, requiresConfirmation: item.status === "awaiting_confirmation",
      ...extra,
    };
  }
  async function execute(task = {}, options = {}) {
    const capabilities = await detectCapabilities();
    const route = routeJarvis(task, capabilities);
    const taskFingerprint = fingerprint(task);
    const scope = options.context || {};
    const scopeKey = fingerprint([scope.organisation || task.organisation_id || "desktop", scope.userId || task.user_id || "desktop", scope.conversationId || task.conversation_id || "main", scope.projectId || task.project_id || task.projet_id || ""]);
    const requestId = options.requestId || task.request_id || task.idempotency_key || null;
    const key = fingerprint([scopeKey, requestId || taskFingerprint]);
    for (const [oldKey, item] of records) {
      if (now() - item.updatedAt >= retention && !inFlight.has(oldKey)) records.delete(oldKey);
    }
    const existing = records.get(key);
    if (existing && existing.fingerprint !== taskFingerprint) return { status: "conflict", requiresConfirmation: false, completedAt: null, error: "Request identifier already belongs to another action." };
    if (options.executionId && existing?.executionId !== options.executionId) return { status: "conflict", requiresConfirmation: false, completedAt: null, error: "Action identifier does not match this request and context." };
    const mutating = route.risk !== "read";
    if (mutating && storageError) return { status: "blocked", requiresConfirmation: false, completedAt: null, error: "Action ledger is unreadable; reconcile it before executing writes." };
    if (existing && mutating && existing.status !== "awaiting_confirmation") return receipt(existing, { duplicate: true, route });
    if (existing?.status === "awaiting_confirmation" && now() - existing.updatedAt > 5 * 60_000) return receipt(existing, { status: "expired", requiresConfirmation: false, error: "This proposal has expired. Prepare a new request." });
    if (records.size >= 1000 && !existing && mutating) return { status: "blocked", requiresConfirmation: false, completedAt: null, error: "Action ledger is full." };
    const item = existing && mutating ? existing : {
      key, fingerprint: taskFingerprint, executionId: crypto.randomUUID(),
      startedAt: new Date(now()).toISOString(), updatedAt: now(), status: "prepared", completedAt: null,
    };
    const base = { executionId: item.executionId, task, route, startedAt: item.startedAt };
    const save = status => {
      item.status = status;
      item.updatedAt = now();
      if (mutating) { records.set(key, item); persist(); }
    };
    if (route.confirmation && options.confirmed !== true) {
      save("awaiting_confirmation");
      const result = { ...base, ...receipt(item) };
      await audit?.({ ...result, phase: "authorize" });
      return result;
    }
    // Reserve before the first asynchronous side effect. A retry or a restart must not execute twice.
    save("running");
    const run = (async () => {
      try {
        await audit?.({ ...base, status: "running", phase: "execute" });
        let output;
        if (route.tool === "web_assistant") {
          output = await executeWeb(task.payload || task);
        } else if (route.tool === "diagnostic" && capabilities.localAgent?.online) {
          output = await localAgentRequest(capabilities.localAgent.port, "/health", { timeoutMs: 3000 });
        } else if (route.tool === "media" && route.engine === "comfyui") {
          const probe = await comfyRequest("/system_stats", { timeoutMs: 3000 });
          const ready = Boolean(probe) && probe.ok !== false && !probe.error;
          save(ready ? "ready_to_execute" : "unavailable");
          const result = { ...base, ...receipt(item), output: { delegated: ready, tool: route.tool, engine: route.engine, runtimeReady: ready } };
          await audit?.({ ...result, phase: "delegate" });
          return result;
        } else {
          save(route.engine === "unavailable" ? "unavailable" : "delegated");
          const result = { ...base, ...receipt(item), output: { delegated: route.engine !== "unavailable", tool: route.tool, engine: route.engine } };
          await audit?.({ ...result, phase: "delegate" });
          return result;
        }
        const status = observedStatus(output);
        item.completedAt = status === "completed" ? new Date(now()).toISOString() : null;
        save(status);
        const result = { ...base, ...receipt(item), output };
        await audit?.({ ...result, phase: status === "completed" ? "verify" : "observe" });
        return result;
      } catch (error) {
        // A transport error does not prove that an external side effect did not happen.
        item.completedAt = null;
        try { save("reconciliation_required"); } catch { storageError = error; }
        const result = { ...base, ...receipt(item), status: "reconciliation_required", error: "Execution result is unknown; verify the original action before retrying." };
        try { await audit?.({ ...result, phase: "error" }); } catch {}
        return result;
      } finally { inFlight.delete(key); }
    })();
    inFlight.set(key, run);
    return run;
  }
  return { execute };
}

module.exports = { createJarvisExecutor, observedStatus };
