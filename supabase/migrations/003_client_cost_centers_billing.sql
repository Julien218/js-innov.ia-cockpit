-- ============================================================
-- 003_client_cost_centers_billing.sql
-- Multi-client Cost Center Billing System for JS-Innov.IA Cockpit
-- 
-- Architecture:
--   client_cost_centers      → one per client/product (e.g. SYNERGIE_DOUR)
--   client_external_mappings → OpenAI project IDs, Railway project IDs
--   client_invoices          → monthly invoices (draft → sent → paid)
--   client_invoice_lines     → forfait, railway, llm_api, other
--   client_cost_imports      → idempotency log for cost imports
--   client_invoice_reminders → reminder tracking
--
-- Constraints:
--   - External ID unique per service_type (no cross-center cost mixing)
--   - One invoice per cost center per period (non-cancelled)
--   - Resync only updates draft invoices (never sent/paid)
--   - Domain annual costs excluded (line_type does not include 'domain')
-- ============================================================

-- --------------------------------------------------------
-- 1. client_cost_centers
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_cost_centers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code     TEXT NOT NULL,                        -- 'SYNERGIE_DOUR', 'HAINOFLOW', etc.
  client_name      TEXT NOT NULL,                        -- 'Synergie Dour'
  client_email     TEXT,                                -- billing email
  client_address   TEXT,                                 -- full postal address
  client_vat_number TEXT,                                -- BE VAT number
  monthly_fee_minor INTEGER NOT NULL DEFAULT 0,          -- cents (19900 = 199.00 EUR)
  currency         TEXT NOT NULL DEFAULT 'EUR',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccc_product_code ON client_cost_centers(product_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ccc_product_unique ON client_cost_centers(product_code) WHERE is_active = true;

-- --------------------------------------------------------
-- 2. client_external_mappings
-- Maps OpenAI project IDs and Railway project IDs to cost centers.
-- An external ID can only belong to ONE cost center per service_type.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_external_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_center_id  UUID NOT NULL REFERENCES client_cost_centers(id) ON DELETE CASCADE,
  service_type    TEXT NOT NULL,                         -- 'openai_project', 'railway_project'
  external_id     TEXT NOT NULL,                          -- e.g. 'proj_xxx' (OpenAI) or Railway project UUID
  external_label  TEXT,                                   -- human-readable name
  is_active       BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cem_cost_center ON client_external_mappings(cost_center_id);
-- CRITICAL: external_id unique per service_type — prevents cost mixing
CREATE UNIQUE INDEX IF NOT EXISTS idx_cem_external_unique
  ON client_external_mappings(service_type, external_id)
  WHERE is_active = true;

-- --------------------------------------------------------
-- 3. client_invoices
-- Monthly invoices per cost center.
-- Statuses: draft → sent → paid / overdue → cancelled
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_center_id  UUID NOT NULL REFERENCES client_cost_centers(id) ON DELETE CASCADE,
  invoice_number  TEXT NOT NULL UNIQUE,                  -- e.g. 'CC-2026-08-001'
  period_year     INTEGER NOT NULL,
  period_month    INTEGER NOT NULL,                      -- 1-12
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  subtotal_minor  INTEGER NOT NULL DEFAULT 0,            -- cents HTVA
  tax_rate        INTEGER NOT NULL DEFAULT 21,            -- 21% TVA Belgium
  tax_amount_minor INTEGER NOT NULL DEFAULT 0,            -- cents TVA
  total_minor     INTEGER NOT NULL DEFAULT 0,             -- cents TTC
  currency        TEXT NOT NULL DEFAULT 'EUR',
  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  due_date        DATE,
  pdf_url         TEXT,
  ubl_xml         TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ci_cost_center ON client_invoices(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_ci_status ON client_invoices(status);
-- Prevent duplicate invoices per period (non-cancelled)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_period_unique
  ON client_invoices(cost_center_id, period_year, period_month)
  WHERE status != 'cancelled';

-- --------------------------------------------------------
-- 4. client_invoice_lines
-- Line types: forfait, railway, llm_api, other
-- NO 'domain' type — annual domain costs are billed separately.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_invoice_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES client_invoices(id) ON DELETE CASCADE,
  line_type       TEXT NOT NULL
                  CHECK (line_type IN ('forfait', 'railway', 'llm_api', 'other')),
  description     TEXT NOT NULL,
  quantity        DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit_price_minor INTEGER NOT NULL DEFAULT 0,            -- cents
  total_minor     INTEGER NOT NULL DEFAULT 0,             -- cents
  external_ref    TEXT,                                   -- reference to external cost entry
  metadata        JSONB DEFAULT '{}',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cil_invoice ON client_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cil_type ON client_invoice_lines(line_type);

-- --------------------------------------------------------
-- 5. client_cost_imports (idempotency log)
-- Records each cost import to prevent duplicates.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_cost_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_center_id  UUID NOT NULL REFERENCES client_cost_centers(id) ON DELETE CASCADE,
  service_type    TEXT NOT NULL,                          -- 'openai', 'railway'
  period_year     INTEGER NOT NULL,
  period_month    INTEGER NOT NULL,
  import_hash     TEXT NOT NULL,                           -- SHA256 of imported data
  total_cost_minor INTEGER NOT NULL DEFAULT 0,
  line_count      INTEGER NOT NULL DEFAULT 0,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cost_center_id, service_type, period_year, period_month, import_hash)
);

CREATE INDEX IF NOT EXISTS idx_cci_period ON client_cost_imports(cost_center_id, period_year, period_month);

-- --------------------------------------------------------
-- 6. client_invoice_reminders
-- Tracks payment reminders sent for overdue invoices.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_invoice_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES client_invoices(id) ON DELETE CASCADE,
  reminder_type   TEXT NOT NULL CHECK (reminder_type IN ('first', 'second', 'final')),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_sent      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_cir_invoice ON client_invoice_reminders(invoice_id);

-- --------------------------------------------------------
-- 7. Initial data: SYNERGIE_DOUR cost center
--    Monthly forfait: 199.00 EUR HTVA (19900 cents)
-- --------------------------------------------------------
INSERT INTO client_cost_centers (
  product_code, client_name, client_email, client_address,
  monthly_fee_minor, currency, is_active
) VALUES (
  'SYNERGIE_DOUR',
  'Synergie Dour',
  'olivier.trevis@outlook.be',
  'Dour, Belgique',
  19900,
  'EUR',
  true
) ON CONFLICT DO NOTHING;

-- --------------------------------------------------------
-- 8. Helper: auto-update updated_at trigger
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ccc_updated ON client_cost_centers;
CREATE TRIGGER trg_ccc_updated BEFORE UPDATE ON client_cost_centers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_ci_updated ON client_invoices;
CREATE TRIGGER trg_ci_updated BEFORE UPDATE ON client_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_cem_updated ON client_external_mappings;
CREATE TRIGGER trg_cem_updated BEFORE UPDATE ON client_external_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- --------------------------------------------------------
-- 9. RLS Policies (service_role only — backend access)
-- --------------------------------------------------------
ALTER TABLE client_cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_external_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_cost_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_invoice_reminders ENABLE ROW LEVEL SECURITY;

-- All tables: service_role full access, no anon access
CREATE POLICY "service_role_all_ccc" ON client_cost_centers
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_all_cem" ON client_external_mappings
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_all_ci" ON client_invoices
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_all_cil" ON client_invoice_lines
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_all_cci" ON client_cost_imports
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_all_cir" ON client_invoice_reminders
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
