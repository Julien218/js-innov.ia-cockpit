"use strict";

const crypto = require("crypto");

function createJarvisExecutor({ routeJarvis, detectCapabilities, executeWeb, localAgentRequest, comfyRequest, audit }) {
  async function execute(task = {}, options = {}) {
    const executionId = crypto.randomUUID();
    const capabilities = await detectCapabilities();
    const route = routeJarvis(task, capabilities);
    const approved = options.confirmed === true;
    const startedAt = new Date().toISOString();
    const base = { executionId, task, route, startedAt };

    if (route.confirmation && !approved) {
      const result = { ...base, status: "awaiting_confirmation", requiresConfirmation: true };
      await audit?.({ ...result, phase: "authorize" });
      return result;
    }

    await audit?.({ ...base, status: "running", phase: "execute" });
    let output;
    if (route.tool === "web_assistant") {
      output = await executeWeb(task.payload || task);
    } else if (route.tool === "diagnostic" && capabilities.localAgent?.online) {
      output = await localAgentRequest(capabilities.localAgent.port, "/health", { timeoutMs: 3000 });
    } else if (route.tool === "media" && route.engine === "comfyui") {
      output = await comfyRequest("/system_stats", { timeoutMs: 3000 });
    } else {
      const result = {
        ...base,
        status: route.engine === "unavailable" ? "unavailable" : "delegated",
        requiresConfirmation: false,
        output: { delegated: route.engine !== "unavailable", tool: route.tool, engine: route.engine },
        completedAt: null,
      };
      await audit?.({ ...result, phase: "delegate" });
      return result;
    }

    const result = { ...base, status: "completed", requiresConfirmation: false, output, completedAt: new Date().toISOString() };
    await audit?.({ ...result, phase: "verify" });
    return result;
  }
  return { execute };
}

module.exports = { createJarvisExecutor };
