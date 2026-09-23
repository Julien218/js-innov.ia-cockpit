const test = require("node:test");
const assert = require("node:assert/strict");
const { routeJarvis } = require("../electron/elynea-tool-router.cjs");

test("routes voice locally only when local agent is online", () => {
  assert.equal(routeJarvis({ intent: "transcribe voice" }, { localAgent: { online: true } }).engine, "local");
  assert.equal(routeJarvis({ intent: "transcribe voice" }, { localAgent: { online: false } }).engine, "unavailable");
});

test("routes media to ComfyUI with cloud fallback", () => {
  assert.equal(routeJarvis({ intent: "render video" }, { comfyui: { online: true } }).engine, "comfyui");
  assert.equal(routeJarvis({ intent: "render video" }, { comfyui: { online: false } }).engine, "cloud_fallback");
});

test("routes infrastructure connectors", () => {
  assert.equal(routeJarvis({ provider: "github", action: "inspect repo" }, { github: true }).tool, "github");
  assert.equal(routeJarvis({ provider: "railway", action: "service status" }, { railway: true }).tool, "railway");
  assert.equal(routeJarvis({ provider: "supabase", action: "inspect rls" }, { supabase: true }).tool, "supabase");
});

test("destructive actions always require confirmation", () => {
  const route = routeJarvis({ provider: "railway", action: "delete production service" }, { railway: true });
  assert.equal(route.risk, "destructive");
  assert.equal(route.confirmation, true);
});
