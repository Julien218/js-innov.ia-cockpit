"use strict";

const RISK = Object.freeze({ READ: "read", WRITE: "write", DESTRUCTIVE: "destructive" });

function normalizeIntent(raw = {}) {
  return {
    intent: String(raw.intent || raw.type || "").trim().toLowerCase(),
    provider: String(raw.provider || "").trim().toLowerCase(),
    action: String(raw.action || raw.task_type || "").trim().toLowerCase(),
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
  const text = [task.intent, task.provider, task.action, task.payloadText].join(" ");
  const localAgent = capabilityOnline(capabilities, "localAgent");
  const comfy = capabilityOnline(capabilities, "comfyui");
  const github = capabilityOnline(capabilities, "github");
  const railway = capabilityOnline(capabilities, "railway");
  const supabase = capabilityOnline(capabilities, "supabase");
  const wavespeed = capabilityOnline(capabilities, "wavespeed");

  if (/delete|remove|destroy|drop|purge|payment|publish|deploy.production|supprim|effac|détrui|detru|purge|paiement|publier|publication|déploiement.production|deploiement.production/.test(text)) {
    return { tool: "guarded_action", engine: "explicit", risk: RISK.DESTRUCTIVE, confirmation: true };
  }
  if (/transcrib|voice|micro|whisper/.test(text)) {
    return { tool: "local_voice", engine: localAgent ? "local" : "unavailable", risk: RISK.READ, confirmation: false };
  }
  if (/video|image|comfy|render|music.motion/.test(text)) {
    return { tool: "media", engine: comfy ? "comfyui" : "cloud_fallback", risk: RISK.WRITE, confirmation: false };
  }
  if (/github|repo|pull.request|commit|branch/.test(text)) {
    return { tool: "github", engine: github ? "connector" : "server", risk: RISK.READ, confirmation: false };
  }
  if (/railway|deployment|service|environment/.test(text)) {
    return { tool: "railway", engine: railway ? "connector" : "server", risk: RISK.READ, confirmation: false };
  }
  if (/supabase|database|postgres|rls|table/.test(text)) {
    return { tool: "supabase", engine: supabase ? "connector" : "server", risk: RISK.READ, confirmation: false };
  }
  if (/wavespeed|wave.speed/.test(text)) {
    return { tool: "wavespeed", engine: wavespeed ? "api" : "unavailable", risk: RISK.WRITE, confirmation: false };
  }
  if (/ionos|domain|redirect|dns/.test(text)) {
    return { tool: "web_assistant", engine: "electron", risk: RISK.WRITE, confirmation: true };
  }
  if (/diagnos|status|health|inspect|check|read|search|analyse|analyz/.test(text)) {
    return { tool: "diagnostic", engine: localAgent ? "local" : "server", risk: RISK.READ, confirmation: false };
  }
  return { tool: "agent", engine: localAgent ? "local_first" : "server", risk: RISK.READ, confirmation: false };
}

module.exports = { RISK, normalizeIntent, capabilityOnline, routeJarvis };
