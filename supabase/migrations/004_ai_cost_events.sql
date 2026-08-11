-- ============================================================
-- 004_ai_cost_events.sql — AI Cost Events Table
-- Stores AI usage events received from external services
-- via POST /api/ai-cost/usage (server-ai-cost.cjs)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_cost_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL DEFAULT 'openai',
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12,6),
  source          TEXT NOT NULL DEFAULT 'unknown',
  request_id      TEXT,
  processing_mode TEXT NOT NULL DEFAULT 'standard',
  metadata        JSONB DEFAULT '{}',
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ace_received ON ai_cost_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ace_model ON ai_cost_events(model);
CREATE INDEX IF NOT EXISTS idx_ace_source ON ai_cost_events(source);

-- RLS: service_role only (server-side access only)
ALTER TABLE ai_cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_ace" ON ai_cost_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
