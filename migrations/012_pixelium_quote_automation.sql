CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS pixelium_commercials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  commission_rate_bps integer,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pixelium_commercials_rate_check CHECK (commission_rate_bps IS NULL OR (commission_rate_bps >= 0 AND commission_rate_bps <= 10000))
);

INSERT INTO pixelium_commercials (code, display_name, commission_rate_bps, metadata)
VALUES ('JP', 'Julien P.', NULL, '{"protected":true,"source":"pixelium-espace-c"}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  active = true,
  metadata = pixelium_commercials.metadata || EXCLUDED.metadata,
  updated_at = now();

CREATE SEQUENCE IF NOT EXISTS pixelium_quote_reference_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS pixelium_quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  reference_number bigint NOT NULL DEFAULT nextval('pixelium_quote_reference_seq'),
  commercial_id uuid NOT NULL REFERENCES pixelium_commercials(id),
  commercial_code text NOT NULL,
  commercial_reference text UNIQUE,
  source text NOT NULL DEFAULT 'pixelium-espace-c',
  offer_code text NOT NULL,
  billing_mode text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  company text,
  email text NOT NULL,
  phone text NOT NULL,
  message text,
  visual_creation boolean NOT NULL DEFAULT false,
  consent_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'received',
  price_cents integer,
  price_period text,
  tax_mode text,
  currency text NOT NULL DEFAULT 'EUR',
  commission_rate_bps integer,
  commission_amount_cents integer,
  quote_send_at timestamptz NOT NULL,
  quote_sent_at timestamptz,
  accepted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pixelium_quote_offer_check CHECK (offer_code IN ('annual','festival')),
  CONSTRAINT pixelium_quote_billing_check CHECK (billing_mode IS NULL OR billing_mode IN ('monthly','annual','one_off')),
  CONSTRAINT pixelium_quote_price_check CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT pixelium_quote_commission_check CHECK (commission_amount_cents IS NULL OR commission_amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS pixelium_quote_requests_created_idx ON pixelium_quote_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS pixelium_quote_requests_commercial_idx ON pixelium_quote_requests(commercial_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pixelium_quote_requests_email_idx ON pixelium_quote_requests(lower(email));

CREATE TABLE IF NOT EXISTS pixelium_email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES pixelium_quote_requests(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  send_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pixelium_email_jobs_kind_check CHECK (kind IN ('confirmation','quote')),
  CONSTRAINT pixelium_email_jobs_status_check CHECK (status IN ('pending','sending','retry','sent','blocked','dead_letter','cancelled'))
);

CREATE INDEX IF NOT EXISTS pixelium_email_jobs_due_idx ON pixelium_email_jobs(status, send_at);

CREATE TABLE IF NOT EXISTS pixelium_quote_events (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES pixelium_quote_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pixelium_quote_events_request_idx ON pixelium_quote_events(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pixelium_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES pixelium_quote_requests(id) ON DELETE CASCADE,
  commercial_id uuid NOT NULL REFERENCES pixelium_commercials(id),
  commercial_code text NOT NULL,
  rate_bps integer,
  amount_cents integer,
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'pending',
  payable_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pixelium_commission_rate_check CHECK (rate_bps IS NULL OR (rate_bps >= 0 AND rate_bps <= 10000)),
  CONSTRAINT pixelium_commission_amount_check CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CONSTRAINT pixelium_commission_status_check CHECK (status IN ('pending','earned','payable','paid','cancelled'))
);