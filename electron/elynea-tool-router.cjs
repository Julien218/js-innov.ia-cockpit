"use strict";

const RISK = Object.freeze({ READ: "read", WRITE: "write", DESTRUCTIVE: "destructive" });
const normal = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function normalizeIntent(raw = {}) {
  return {
    intent: normal(raw.intent || raw.type),
    provider: normal(raw.provider),
    action: normal(raw.action || raw.task_type),
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload : raw,
    payloadText: raw.payload && typeof raw.payload === "object" ? JSON.stringify(raw.payload).toLowerCase() : String(raw.payload || "").toLowerCase(),
  };
}

function capabilityOnline(capabilities, name) {
  const value = capabilities?.[name];
  return value === true || value?.online === true;
}

function routeJarvis(raw = {}, capabilities = {}) {
  const task = normalizeIntent(raw);
  // A document body, prompt or filename is data, not an instruction to change tools.
  const text = [task.intent, task.provider, task.action].join(" ").replace(/[._-]/g, " ");
  const localAgent = capabilityOnline(capabilities, "localAgent");
  const comfy = capabilityOnline(capabilities, "comfyui");
  const localOnly = raw.local_only === true || task.payload.local_only === true
    || [raw.execution_mode, raw.mode, task.payload.execution_mode, task.payload.mode].some(v => normal(v) === "local")
    || /\b(?:en local|localement|local only|offline|hors ligne)\b/.test(text);
  // Nested action fields can raise risk, but document/prompt content cannot select a tool.
  const safetyText = [text, normal(task.payload.action), normal(task.payload.task_type), normal(task.payload.instruction)].join(" ").replace(/[._-]/g, " ");
  const write = /\b(?:create|update|write|commit|merge|push|modify|send|move|archive|cree|creer|modifie|modifier|envoie|envoyer|deplace|classer|classe|archive|ajoute|ajouter)\b/.test(safetyText);
  const destructive = /\b(?:delete|remove|destroy|drop|purge|truncate|payment|publish|deploy|supprime|supprimer|efface|effacer|detruire|detruis|paiement|publier|publie|publication|deploiement|deploie)\b|\b(?:vider|empty)\s+(?:la\s+)?table\b/.test(safetyText);
  if (destructive) return { tool: "guarded_action", engine: "explicit", risk: RISK.DESTRUCTIVE, confirmation: true };

  if (/\b(?:wavespeed|wave speed)\b/.test(text)) {
    return { tool: "wavespeed", engine: localOnly || !capabilityOnline(capabilities, "wavespeed") ? "unavailable" : "api", risk: RISK.WRITE, confirmation: true, localOnly };
  }
  if (/\b(?:transcrib\w*|transcri\w*|voice|voix|micro|whisper)\b/.test(text)) {
    return { tool: "local_voice", engine: localAgent ? "local" : "unavailable", risk: RISK.READ, confirmation: false };
  }
  const connector = [
    ["documents", /\b(?:dropbox|drive|documents?|fichiers?)\b/],
    ["email", /\b(?:gmail|outlook|emails?|e mails?|courriels?|boite mail)\b/],
    ["calendar", /\b(?:calendar|calendrier|agenda|rendez vous)\b/],
    ["github", /\b(?:github|repos?|repository|pull request|commit|branch)\b/],
    ["railway", /\b(?:railway|deployment|service|environment)\b/],
    ["supabase", /\b(?:supabase|database|postgres|rls|table)\b/],
  ].find(([, pattern]) => pattern.test(text));
  // An explicit connector takes precedence over words such as "image" in a file search.
  if (connector && !/\b(?:genere|generer|generate|render|rendu|montage|animer|anime)\b/.test(task.intent + " " + task.action)) {
    const tool = connector[0];
    return { tool, engine: capabilityOnline(capabilities, tool) ? "connector" : "server", risk: write ? RISK.WRITE : RISK.READ, confirmation: write };
  }
  if (/\b(?:videos?|images?|comfyui|comfy|render|rendu|music motion|montage|animation|animer|anime)\b/.test(text)) {
    const workflow = /\b(?:montage|assemble|assembler|edit|editing)\b/.test(text) ? "montage"
      : /\b(?:animation|animer|anime|image to video|i2v)\b/.test(text) ? "animation"
        : /\b(?:image|images)\b/.test(text) && !/\b(?:video|videos)\b/.test(text) ? "image" : "video";
    const engine = workflow === "montage" ? (localAgent ? "local" : "unavailable")
      : comfy ? "comfyui" : localOnly ? "unavailable" : "cloud_fallback";
    return { tool: "media", engine, workflow, localOnly, risk: RISK.WRITE, confirmation: engine === "cloud_fallback" };
  }
  if (/\b(?:ionos|domain|domaine|redirect|dns)\b/.test(text)) {
    return { tool: "web_assistant", engine: "electron", risk: RISK.WRITE, confirmation: true };
  }
  if (/\b(?:diagnos\w*|status|statut|health|inspect\w*|check|read|search|analyse|analyz\w*)\b/.test(text)) {
    return { tool: "diagnostic", engine: localAgent ? "local" : "server", risk: RISK.READ, confirmation: false };
  }
  return { tool: "agent", engine: localAgent ? "local_first" : "server", risk: RISK.READ, confirmation: false };
}

module.exports = { RISK, normalizeIntent, capabilityOnline, routeJarvis };
