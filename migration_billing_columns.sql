-- ============================================================
-- migration_billing_columns.sql
-- Ajoute les colonnes manquantes aux tables Devis et Facture
-- À exécuter dans Supabase (projet gfjpryakxzdzwnazlsfz) via SQL Editor
-- Sécurisé : ADD COLUMN IF NOT EXISTS (n'altère pas les colonnes existantes)
-- ============================================================

-- ── Table Devis ─────────────────────────────────────────────
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "numero" TEXT;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "client_nom" TEXT;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "client_email" TEXT;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "objet" TEXT;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "montant_ht" NUMERIC(10,2) DEFAULT 0;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "tva" NUMERIC(5,2) DEFAULT 21;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "montant_tva" NUMERIC(10,2) DEFAULT 0;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "montant_ttc" NUMERIC(10,2) DEFAULT 0;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "statut" TEXT DEFAULT 'brouillon';
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "date_emission" DATE;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "date_validite" DATE;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Devis" ADD COLUMN IF NOT EXISTS "items" JSONB;

-- ── Table Facture ───────────────────────────────────────────
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "numero" TEXT;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "client_nom" TEXT;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "client_email" TEXT;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "montant_ht" NUMERIC(10,2) DEFAULT 0;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "tva" NUMERIC(5,2) DEFAULT 21;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "montant_tva" NUMERIC(10,2) DEFAULT 0;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "montant_ttc" NUMERIC(10,2) DEFAULT 0;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "statut" TEXT DEFAULT 'brouillon';
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "date_emission" DATE;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "date_echeance" DATE;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Facture" ADD COLUMN IF NOT EXISTS "items" JSONB;

-- ── Index pour recherche rapide ─────────────────────────────
CREATE INDEX IF NOT EXISTS "devis_numero_idx" ON "Devis" ("numero");
CREATE INDEX IF NOT EXISTS "devis_client_nom_idx" ON "Devis" ("client_nom");
CREATE INDEX IF NOT EXISTS "devis_statut_idx" ON "Devis" ("statut");
CREATE INDEX IF NOT EXISTS "facture_numero_idx" ON "Facture" ("numero");
CREATE INDEX IF NOT EXISTS "facture_client_nom_idx" ON "Facture" ("client_nom");
CREATE INDEX IF NOT EXISTS "facture_statut_idx" ON "Facture" ("statut");
