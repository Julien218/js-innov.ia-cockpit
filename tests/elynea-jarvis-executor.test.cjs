const test = require("node:test");
const assert = require("node:assert/strict");
const { createJarvisExecutor } = require("../electron/elynea-jarvis-executor.cjs");

function build(route) {
  const audit = [];
  const executor = createJarvisExecutor({
    routeJarvis: () => route,
    detectCapabilities: async () => ({ localAgent: { online: true, port: 8788 } }),
    executeWeb: async () => ({ ok: true }),
    localAgentRequest: async () => ({ ok: true }),
    comfyRequest: async () => ({ ok: true }),
    audit: async (entry) => audit.push(entry),
  });
  return { executor, audit };
}

test("blocks guarded execution until explicit confirmation", async () => {
  const { executor, audit } = build({ tool: "web_assistant", engine: "electron", risk: "write", confirmation: true });
  const result = await executor.execute({ provider: "ionos" });
  assert.equal(result.status, "awaiting_confirmation");
  assert.equal(result.requiresConfirmation, true);
  assert.equal(audit[0].phase, "authorize");
});

test("executes after confirmation and journals execution plus verification", async () => {
  const { executor, audit } = build({ tool: "web_assistant", engine: "electron", risk: "write", confirmation: true });
  const result = await executor.execute({ provider: "ionos" }, { confirmed: true });
  assert.equal(result.status, "completed");
  assert.deepEqual(audit.map((x) => x.phase), ["execute", "verify"]);
});

test("read-only local diagnostic executes without confirmation", async () => {
  const { executor } = build({ tool: "diagnostic", engine: "local", risk: "read", confirmation: false });
  const result = await executor.execute({ intent: "health check" });
  assert.equal(result.status, "completed");
  assert.equal(result.output.ok, true);
});


test("delegated routes are never reported completed", async () => {
  const { executor, audit } = build({ tool: "github", engine: "connector", risk: "read", confirmation: false });
  const result = await executor.execute({ provider: "github", action: "inspect repo" });
  assert.equal(result.status, "delegated");
  assert.equal(result.completedAt, null);
  assert.equal(audit.at(-1).phase, "delegate");
});

test("unavailable routes are explicit and never verified", async () => {
  const { executor, audit } = build({ tool: "local_voice", engine: "unavailable", risk: "read", confirmation: false });
  const result = await executor.execute({ intent: "transcribe voice" });
  assert.equal(result.status, "unavailable");
  assert.equal(audit.at(-1).phase, "delegate");
});
