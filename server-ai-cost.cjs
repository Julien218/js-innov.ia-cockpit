// ============================================================
// server-ai-cost.cjs — AI Cost Ingestion Endpoint
// Receives AI usage events from external services (jsinnovia-agent, etc.)
// Auth: x-ai-cost-key header must match AI_COST_INGEST_KEY env var
// ============================================================

const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// ─── Config ───────────────────────────────────────────────────────────────────
const INGEST_KEY = process.env.AI_COST_INGEST_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Lazy-init Supabase client (server-side, service_role)
let supabase = null;
function getSupabase() {
  if (supabase) return supabase;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  return supabase;
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireIngestKey(req, res, next) {
  const key = req.headers["x-ai-cost-key"];
  if (!INGEST_KEY || key !== INGEST_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── Health check ─────────────────────────────────────────────────────────────
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    configured: !!INGEST_KEY,
    supabase: !!getSupabase(),
  });
});

// ─── POST /usage — Receive an AI cost event ──────────────────────────────────
router.post("/usage", requireIngestKey, async (req, res) => {
  try {
    const {
      provider,
      model,
      usage,
      input_tokens,
      output_tokens,
      cost_usd,
      source,
      request_id,
      processing_mode,
      metadata,
      created_at,
    } = req.body;

    // Validate minimum fields
    if (!model) {
      return res.status(400).json({ error: "model is required" });
    }

    // Build event record
    const event = {
      provider: provider || "openai",
      model: model || "unknown",
      input_tokens: input_tokens || usage?.prompt_tokens || usage?.input_tokens || 0,
      output_tokens: output_tokens || usage?.completion_tokens || usage?.output_tokens || 0,
      total_tokens: (usage?.total_tokens) ||
        (input_tokens || 0) + (output_tokens || 0) +
        (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
      cost_usd: cost_usd || null,
      source: source || "unknown",
      request_id: request_id || null,
      processing_mode: processing_mode || "standard",
      metadata: metadata || {},
      received_at: new Date().toISOString(),
      event_created_at: created_at || new Date().toISOString(),
    };

    // Try to persist to Supabase
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from("ai_cost_events").insert(event);
      if (error) {
        console.warn("[AI-COST] Supabase insert failed:", error.message);
        // Still return 200 — we don't want to block the agent
      }
    } else {
      // No Supabase — log to console as fallback
      console.log("[AI-COST] Event (no DB):", JSON.stringify({
        model: event.model,
        tokens: event.total_tokens,
        source: event.source,
      }));
    }

    // Always return 200 — fire-and-forget pattern
    res.status(200).json({ ok: true, model: event.model, tokens: event.total_tokens });
  } catch (err) {
    console.error("[AI-COST] Error:", err.message);
    // Still 200 to avoid blocking the agent
    res.status(200).json({ ok: false, error: "internal" });
  }
});

// ─── GET /events — List recent events (for dashboard) ────────────────────────
router.get("/events", requireIngestKey, async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(503).json({ error: "Supabase not configured" });

    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const { data, error } = await sb
      .from("ai_cost_events")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /summary — Aggregated summary (for dashboard) ───────────────────────
router.get("/summary", requireIngestKey, async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(503).json({ error: "Supabase not configured" });

    const days = parseInt(req.query.days) || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await sb
      .from("ai_cost_events")
      .select("model, input_tokens, output_tokens, total_tokens, cost_usd, source, received_at")
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false });

    if (error) throw error;

    // Aggregate in JS (Supabase free tier doesn't have great aggregation support)
    const events = data || [];
    const byModel = {};
    const bySource = {};
    const byDay = {};
    let totalCost = 0;
    let totalTokens = 0;

    for (const e of events) {
      const model = e.model || "unknown";
      const source = e.source || "unknown";
      const day = (e.received_at || "").split("T")[0];

      if (!byModel[model]) byModel[model] = { count: 0, tokens: 0, cost: 0 };
      byModel[model].count++;
      byModel[model].tokens += e.total_tokens || 0;
      byModel[model].cost += parseFloat(e.cost_usd) || 0;

      if (!bySource[source]) bySource[source] = { count: 0, tokens: 0, cost: 0 };
      bySource[source].count++;
      bySource[source].tokens += e.total_tokens || 0;
      bySource[source].cost += parseFloat(e.cost_usd) || 0;

      if (!byDay[day]) byDay[day] = { count: 0, tokens: 0, cost: 0 };
      byDay[day].count++;
      byDay[day].tokens += e.total_tokens || 0;
      byDay[day].cost += parseFloat(e.cost_usd) || 0;

      totalCost += parseFloat(e.cost_usd) || 0;
      totalTokens += e.total_tokens || 0;
    }

    res.json({
      period_days: days,
      total_events: events.length,
      total_tokens: totalTokens,
      total_cost_usd: totalCost,
      by_model: byModel,
      by_source: bySource,
      by_day: byDay,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
