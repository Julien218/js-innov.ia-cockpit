-- =============================================================================
-- Migration Supabase : Framework Email Central Cockpit JS-Innov.IA
-- Fichier : supabase/migrations/001_email_core.sql
-- Projet Supabase cible : rzvvwcwyaddzsaattwqt (auth/assets)
-- Description : Création des tables Brand, EmailLog, EmailQueue, EmailTemplate,
--               index de performance, déclencheurs updated_at, sécurité RLS,
--               et données de démarrage (seed) pour les 7 marques du groupe.
-- =============================================================================

-- Activation des extensions requises pour la génération d'UUID uniques
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Fonction utilitaire : Mise à jour automatique de la colonne updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS 'Met à jour automatiquement le champ updated_at lors d une modification de ligne.';

-- =============================================================================
-- 1. Table : Brand (Configuration multi-marques)
-- =============================================================================
-- Description : Stocke la configuration d expéditeur, l identité visuelle, 
-- les surcharges SMTP et le domaine pour chaque marque du groupe JS-Innov.IA.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."Brand" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    from_address TEXT NOT NULL,
    from_name TEXT,
    reply_to TEXT,
    signature_html TEXT,
    logo_url TEXT,
    brand_color TEXT DEFAULT '#D4AF37',
    domain TEXT,
    smtp_override JSONB,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commentaires explicatifs pour la table Brand
COMMENT ON TABLE public."Brand" IS 'Table de configuration des marques (multi-tenancy email). Contient les adresses d expéditeur et paramètres visuels/SMTP par marque.';
COMMENT ON COLUMN public."Brand".id IS 'Identifiant unique (UUID) de la marque.';
COMMENT ON COLUMN public."Brand".name IS 'Nom d affichage de la marque (ex: JS-Innov.IA).';
COMMENT ON COLUMN public."Brand".slug IS 'Identifiant texte unique (slug) de la marque (ex: js-innov-ia).';
COMMENT ON COLUMN public."Brand".from_address IS 'Adresse email d expéditeur par défaut.';
COMMENT ON COLUMN public."Brand".from_name IS 'Nom d expéditeur affiché dans le client email.';
COMMENT ON COLUMN public."Brand".reply_to IS 'Adresse de réponse (Reply-To) optionnelle.';
COMMENT ON COLUMN public."Brand".signature_html IS 'Signature HTML par défaut pour les emails de la marque.';
COMMENT ON COLUMN public."Brand".logo_url IS 'URL du logo officiel de la marque pour les templates.';
COMMENT ON COLUMN public."Brand".brand_color IS 'Couleur primaire de la marque au format Hex (ex: #D4AF37).';
COMMENT ON COLUMN public."Brand".domain IS 'Domaine web associé à la marque.';
COMMENT ON COLUMN public."Brand".smtp_override IS 'Surcharge des paramètres SMTP IONOS par défaut (optionnel, JSONB).';
COMMENT ON COLUMN public."Brand".active IS 'Indicateur d activation de la marque.';

-- Déclencheur updated_at pour Brand
DROP TRIGGER IF EXISTS trigger_brand_updated_at ON public."Brand";
CREATE TRIGGER trigger_brand_updated_at
    BEFORE UPDATE ON public."Brand"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Activation RLS sur Brand (Service role uniquement)
ALTER TABLE public."Brand" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. Table : EmailLog (Audit immuable de chaque tentative d'envoi)
-- =============================================================================
-- Description : Journal d audit immuable enregistrant toutes les tentatives 
-- d envoi d email, les statuts d exécution, les erreurs et métadonnées associées.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."EmailLog" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT DEFAULT 'default',
    application TEXT NOT NULL,
    brand TEXT NOT NULL,
    message_id TEXT,
    idempotency_key TEXT UNIQUE,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    cc TEXT[],
    bcc TEXT[],
    subject TEXT NOT NULL,
    template TEXT,
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'cancelled', 'dead_letter', 'pending', 'sending', 'retry')),
    provider TEXT DEFAULT 'ionos',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Commentaires explicatifs pour la table EmailLog
COMMENT ON TABLE public."EmailLog" IS 'Journal d audit immuable enregistrant chaque tentative d envoi d email avec son statut et ses erreurs.';
COMMENT ON COLUMN public."EmailLog".id IS 'Identifiant unique de la tentative d envoi.';
COMMENT ON COLUMN public."EmailLog".tenant_id IS 'Identifiant du tenant (défaut: default).';
COMMENT ON COLUMN public."EmailLog".application IS 'Application émettrice (ex: FacturaPro, HainoFlow, Cockpit).';
COMMENT ON COLUMN public."EmailLog".brand IS 'Slug de la marque associée à l envoi.';
COMMENT ON COLUMN public."EmailLog".message_id IS 'Identifiant unique RFC Message-ID attribué par le serveur SMTP/provider.';
COMMENT ON COLUMN public."EmailLog".idempotency_key IS 'Clé d idempotence unique pour empêcher les doublons d envoi.';
COMMENT ON COLUMN public."EmailLog".from_address IS 'Adresse email d expéditeur.';
COMMENT ON COLUMN public."EmailLog".to_address IS 'Adresse email du destinataire principal.';
COMMENT ON COLUMN public."EmailLog".cc IS 'Tableau des adresses email en copie carbone (CC).';
COMMENT ON COLUMN public."EmailLog".bcc IS 'Tableau des adresses email en copie carbone cachée (BCC).';
COMMENT ON COLUMN public."EmailLog".subject IS 'Sujet de l email.';
COMMENT ON COLUMN public."EmailLog".template IS 'Nom ou identifiant du template d email utilisé.';
COMMENT ON COLUMN public."EmailLog".status IS 'Statut de l envoi (sent, failed, cancelled, dead_letter, pending, sending, retry).';
COMMENT ON COLUMN public."EmailLog".provider IS 'Fournisseur de service SMTP utilisé (défaut: ionos).';
COMMENT ON COLUMN public."EmailLog".created_at IS 'Horodatage de création de la demande d envoi.';
COMMENT ON COLUMN public."EmailLog".sent_at IS 'Horodatage de la confirmation de transmission réussie.';
COMMENT ON COLUMN public."EmailLog".error_code IS 'Code d erreur retourné par le provider SMTP en cas d échec.';
COMMENT ON COLUMN public."EmailLog".error_message IS 'Message d erreur détaillé en cas d échec.';
COMMENT ON COLUMN public."EmailLog".retry_count IS 'Nombre de tentatives de réémission effectuées.';
COMMENT ON COLUMN public."EmailLog".metadata IS 'Métadonnées additionnelles au format JSONB.';

-- -----------------------------------------------------------------------------
-- Index pour EmailLog
-- -----------------------------------------------------------------------------

-- Index 1 : Filtrage par marque, statut et tri chronologique descendant
CREATE INDEX IF NOT EXISTS idx_email_log_brand_status_created 
    ON public."EmailLog" (brand, status, created_at DESC);
COMMENT ON INDEX idx_email_log_brand_status_created IS 'Optimise les recherches d audit filtrées par marque et statut, triées par date récente.';

-- Index 2 : Recherche rapide par clé d'idempotence
CREATE INDEX IF NOT EXISTS idx_email_log_idempotency_key 
    ON public."EmailLog" (idempotency_key);
COMMENT ON INDEX idx_email_log_idempotency_key IS 'Permet la vérification ultra-rapide des doublons via la clé d idempotence.';

-- Index 3 : Analyse des envois par application applicative
CREATE INDEX IF NOT EXISTS idx_email_log_app_created_at 
    ON public."EmailLog" (application, created_at DESC);
COMMENT ON INDEX idx_email_log_app_created_at IS 'Accélère l extraction de métriques d envoi par application cliente (Cockpit, FacturaPro, etc.).';

-- Activation RLS sur EmailLog (Service role uniquement)
ALTER TABLE public."EmailLog" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. Table : EmailQueue (File d'attente persistante)
-- =============================================================================
-- Description : File d attente asynchrone gérant le traitement des envois d emails,
-- le plancher des tentatives (retry scheduling), le verrouillage distribué et la dead-letter queue.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."EmailQueue" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_log_id UUID REFERENCES public."EmailLog"(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'retry', 'cancelled')) DEFAULT 'pending',
    priority INT DEFAULT 5,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 5,
    next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    last_error_code TEXT,
    last_error_message TEXT,
    dead_letter BOOLEAN DEFAULT false,
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commentaires explicatifs pour la table EmailQueue
COMMENT ON TABLE public."EmailQueue" IS 'File d attente persistante pour le traitement asynchrone des envois d emails et la gestion des retries.';
COMMENT ON COLUMN public."EmailQueue".id IS 'Identifiant unique de l élément en file d attente.';
COMMENT ON COLUMN public."EmailQueue".email_log_id IS 'Référence vers l entrée d audit EmailLog correspondante.';
COMMENT ON COLUMN public."EmailQueue".status IS 'Statut de traitement dans la file (pending, sending, sent, failed, retry, cancelled).';
COMMENT ON COLUMN public."EmailQueue".priority IS 'Niveau de priorité du message (1 = priorité maximale, 5 = défaut).';
COMMENT ON COLUMN public."EmailQueue".attempts IS 'Nombre de tentatives d envoi déjà effectuées.';
COMMENT ON COLUMN public."EmailQueue".max_attempts IS 'Nombre maximal de tentatives autorisées avant basculement en dead_letter.';
COMMENT ON COLUMN public."EmailQueue".next_attempt_at IS 'Horodatage au-delà duquel la prochaine tentative doit être exécutée.';
COMMENT ON COLUMN public."EmailQueue".last_error_code IS 'Dernier code d erreur rencontré.';
COMMENT ON COLUMN public."EmailQueue".last_error_message IS 'Dernier message d erreur enregistré.';
COMMENT ON COLUMN public."EmailQueue".dead_letter IS 'Indique si l email a échoué définitivement (Dead Letter Queue).';
COMMENT ON COLUMN public."EmailQueue".locked_at IS 'Verrou temporel pour éviter qu un autre worker ne traite le même email lors d un redémarrage.';

-- Déclencheur updated_at pour EmailQueue
DROP TRIGGER IF EXISTS trigger_email_queue_updated_at ON public."EmailQueue";
CREATE TRIGGER trigger_email_queue_updated_at
    BEFORE UPDATE ON public."EmailQueue"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Index pour EmailQueue
-- -----------------------------------------------------------------------------

-- Index 1 : Récupération des messages à traiter par les workers (pending / retry)
CREATE INDEX IF NOT EXISTS idx_email_queue_status_next_attempt 
    ON public."EmailQueue" (status, next_attempt_at) 
    WHERE status IN ('pending', 'retry');
COMMENT ON INDEX idx_email_queue_status_next_attempt IS 'Index partiel permettant au worker de dépiler très efficacement les messages prêts à l envoi.';

-- Index 2 : Monitoring des échecs définitifs (Dead-letter queue)
CREATE INDEX IF NOT EXISTS idx_email_queue_dead_letter 
    ON public."EmailQueue" (dead_letter) 
    WHERE dead_letter = true;
COMMENT ON INDEX idx_email_queue_dead_letter IS 'Index partiel permettant de cibler immédiatement les emails en échec critique.';

-- Index 3 : Recovery après crash/restart pour débloquer les messages 'sending' coincés
CREATE INDEX IF NOT EXISTS idx_email_queue_locked_at 
    ON public."EmailQueue" (locked_at) 
    WHERE status = 'sending';
COMMENT ON INDEX idx_email_queue_locked_at IS 'Index partiel autorisant la reprise rapide sur panne pour réinitialiser les verrous expirés.';

-- Activation RLS sur EmailQueue (Service role uniquement)
ALTER TABLE public."EmailQueue" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. Table : EmailTemplate (Templates réutilisables par marque)
-- =============================================================================
-- Description : Modèles d emails dynamiques paramétrables par marque, avec support
-- des corps HTML / Texte brut et définition de schémas de variables JSONB.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."EmailTemplate" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand TEXT NOT NULL,
    name TEXT NOT NULL,
    subject TEXT,
    body_html TEXT,
    body_text TEXT,
    variables_schema JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT email_template_brand_name_key UNIQUE (brand, name)
);

-- Commentaires explicatifs pour la table EmailTemplate
COMMENT ON TABLE public."EmailTemplate" IS 'Table des gabarits (templates) réutilisables d emails par marque avec variables dynamiques.';
COMMENT ON COLUMN public."EmailTemplate".id IS 'Identifiant unique du template.';
COMMENT ON COLUMN public."EmailTemplate".brand IS 'Slug de la marque propriétaire du template.';
COMMENT ON COLUMN public."EmailTemplate".name IS 'Nom unique du template au sein de la marque (ex: welcome_email, invoice_notice).';
COMMENT ON COLUMN public."EmailTemplate".subject IS 'Sujet du template supportant les variables d interpolation {{variable}}.';
COMMENT ON COLUMN public."EmailTemplate".body_html IS 'Contenu du corps au format HTML.';
COMMENT ON COLUMN public."EmailTemplate".body_text IS 'Contenu alternatif au format texte brut.';
COMMENT ON COLUMN public."EmailTemplate".variables_schema IS 'Schéma JSON Validation/Documentation des variables attendues.';

-- Déclencheur updated_at pour EmailTemplate
DROP TRIGGER IF EXISTS trigger_email_template_updated_at ON public."EmailTemplate";
CREATE TRIGGER trigger_email_template_updated_at
    BEFORE UPDATE ON public."EmailTemplate"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Index pour EmailTemplate
-- -----------------------------------------------------------------------------

-- Index 1 : Recherche des templates par marque
CREATE INDEX IF NOT EXISTS idx_email_template_brand 
    ON public."EmailTemplate" (brand);
COMMENT ON INDEX idx_email_template_brand IS 'Optimise le chargement et le filtrage des templates par marque.';

-- Activation RLS sur EmailTemplate (Service role uniquement)
ALTER TABLE public."EmailTemplate" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. Seed Data : Insertion/Mise à jour des 7 marques du groupe JS-Innov.IA
-- =============================================================================

INSERT INTO public."Brand" (
    name,
    slug,
    from_address,
    from_name,
    brand_color,
    domain,
    active
) VALUES
    (
        'JS-Innov.IA',
        'js-innov-ia',
        'info@jsinnovia.store',
        'JS-Innov.IA',
        '#D4AF37',
        'jsinnovia.com',
        true
    ),
    (
        'HainoFlow',
        'hainoflow',
        'contact@hainoflow.jsinnovia.com',
        'HainoFlow',
        '#06B6D4',
        'hainoflow.jsinnovia.com',
        true
    ),
    (
        'FacturaPro',
        'facturapro',
        'contact@facturapro.jsinnovia.com',
        'FacturaPro',
        '#7C3AED',
        'facturapro.jsinnovia.com',
        true
    ),
    (
        'Assurances Dour',
        'assurances-dour',
        'info@assurances-dour.be',
        'Assurances Dour',
        '#10b981',
        'assurances-dour.be',
        true
    ),
    (
        'VilleConnect OS',
        'ville-connect-os',
        'contact@villeconnectos.jsinnovia.com',
        'VilleConnect OS',
        '#3b82f6',
        'villeconnectos.jsinnovia.com',
        true
    ),
    (
        'Synergie Dour',
        'synergie-dour',
        'contact@synergiedour.be',
        'Synergie Dour',
        '#f59e0b',
        'synergiedour.be',
        true
    ),
    (
        'Jytrix AI',
        'jytrix-ai',
        'contact@jytrix.ai',
        'Jytrix AI',
        '#ec4899',
        'jytrix.ai',
        true
    )
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    from_address = EXCLUDED.from_address,
    from_name = EXCLUDED.from_name,
    brand_color = EXCLUDED.brand_color,
    domain = EXCLUDED.domain,
    active = EXCLUDED.active,
    updated_at = NOW();

-- =============================================================================
-- Fin du fichier de migration 001_email_core.sql
-- =============================================================================
