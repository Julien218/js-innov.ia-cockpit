import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  FileVideo2,
  Network,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import CampaignWizard from '@/components/publisya/CampaignWizard';
import CampaignReview from '@/components/publisya/CampaignReview';
import { getPublisyaDashboard, getPublisyaStatus, listPublisyaCampaigns } from '@/lib/publisyaClient';

const platformLabels = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
};

const statusLabels = {
  draft: 'Brouillon',
  analyzing: 'Analyse',
  generated: 'Généré',
  awaiting_approval: 'À valider',
  needs_changes: 'À corriger',
  approved: 'Approuvé',
  scheduled: 'Programmé',
  publishing: 'Publication',
  published: 'Publié',
  partially_published: 'Partiel',
  failed: 'Erreur',
  canceled: 'Annulé',
};

function MetricCard({ icon: Icon, label, value, detail }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-2xl font-bold text-foreground">{value}</span>
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function CampaignRow({ campaign, onOpen }) {
  const networks = Array.isArray(campaign.target_platforms) ? campaign.target_platforms : [];
  return (
    <button
      type="button"
      onClick={() => onOpen(campaign.id)}
      className="flex w-full flex-col gap-3 border-b border-border px-4 py-4 text-left transition hover:bg-muted/35 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{campaign.title}</p>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{statusLabels[campaign.status] || campaign.status}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {networks.length ? networks.map((id) => platformLabels[id] || id).join(' · ') : 'Aucun réseau'}
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Validation humaine</span>
        <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}

export default function Publisya() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['publisya', 'status'],
    queryFn: getPublisyaStatus,
    staleTime: 60_000,
  });
  const dashboard = useQuery({
    queryKey: ['publisya', 'dashboard'],
    queryFn: getPublisyaDashboard,
    staleTime: 30_000,
  });
  const campaignList = useQuery({
    queryKey: ['publisya', 'campaigns'],
    queryFn: listPublisyaCampaigns,
    enabled: Boolean(status.data?.capabilities?.campaigns),
    staleTime: 20_000,
  });

  const providers = status.data?.providers || [];
  const campaignCounts = dashboard.data?.campaigns || {};
  const campaigns = campaignList.data?.campaigns || [];
  const recentCampaigns = campaigns.slice(0, 8);
  const connected = dashboard.data?.connections?.connected || 0;
  const isFoundationMode = status.data?.publishing_enabled === false;
  const databaseReady = Boolean(status.data?.infrastructure?.database_ready);
  const mediaReady = Boolean(status.data?.infrastructure?.media_storage_ready);
  const aiReady = Boolean(status.data?.infrastructure?.ai_ready);
  const apiError = status.isError || dashboard.isError;

  const refreshOverview = () => {
    queryClient.invalidateQueries({ queryKey: ['publisya', 'campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['publisya', 'dashboard'] });
  };

  const handleCreated = (campaign) => {
    refreshOverview();
    if (campaign?.id) setSelectedCampaignId(campaign.id);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Publisya"
        subtitle="Un contenu. Chaque réseau. Le bon message."
        actions={
          <Button onClick={() => setWizardOpen(true)} disabled={!databaseReady} title={databaseReady ? 'Créer une campagne Publisya' : 'Initialisation de la base Publisya requise'}>
            <UploadCloud className="mr-2 h-4 w-4" />
            Nouveau contenu
          </Button>
        }
      />

      <section className="overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-card via-card to-primary/5 p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">PUBLISYA · by JS‑Innov.IA</span>
              {isFoundationMode && (
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700">Publication externe verrouillée</span>
              )}
            </div>
            <h2 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">Votre diffusion sociale, centralisée dans le Cockpit.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Créez une campagne, déposez une image ou une vidéo, lancez l’analyse puis corrigez séparément chaque proposition avant de l’approuver.
            </p>
          </div>
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-primary/15 bg-primary/10 text-primary">
            <Network className="h-9 w-9" />
          </div>
        </div>
      </section>

      {apiError && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Le service Publisya ne répond pas encore correctement.</p>
            <p className="mt-1 text-xs opacity-80">Le module reste isolé ; aucun réseau social ni aucune publication n’est affecté.</p>
          </div>
        </div>
      )}

      {!status.isLoading && !databaseReady && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Base Publisya préparée mais non initialisée.</p>
            <p className="mt-1 text-xs opacity-80">La migration reste volontairement non appliquée sur la production. Le bouton de création est donc bloqué proprement.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={FileVideo2}
          label="Campagnes"
          value={campaigns.length}
          detail="Campagnes visibles uniquement dans cet espace client"
        />
        <MetricCard
          icon={ShieldCheck}
          label="À valider"
          value={campaignCounts.awaiting_approval || 0}
          detail="Aucune publication ne part sans autorisation"
        />
        <MetricCard
          icon={CalendarClock}
          label="Programmées"
          value={campaignCounts.scheduled || 0}
          detail="La programmation sera activée après les connecteurs"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Comptes connectés"
          value={`${connected}/${providers.length || 5}`}
          detail="Connexions OAuth officielles prévues au Lot 3"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Campagnes récentes</h3>
            <p className="mt-1 text-sm text-muted-foreground">Ouvrez une campagne pour lancer l’analyse, relire chaque réseau et approuver les propositions.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">{databaseReady ? `${campaigns.length} campagne(s)` : 'Initialisation requise'}</span>
        </div>
        {databaseReady && campaignList.isLoading ? (
          <div className="space-y-2 p-5">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : recentCampaigns.length ? (
          recentCampaigns.map((campaign) => <CampaignRow key={campaign.id} campaign={campaign} onOpen={setSelectedCampaignId} />)
        ) : (
          <div className="p-8 text-center">
            <FileVideo2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-semibold text-foreground">Aucune campagne enregistrée</p>
            <p className="mt-1 text-xs text-muted-foreground">Le premier contenu apparaîtra ici après création.</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Réseaux pris en charge</h3>
            <p className="mt-1 text-sm text-muted-foreground">Chaque connecteur restera indépendant afin qu’une erreur sur un réseau ne bloque pas les autres.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">Publication réelle désactivée au Lot 2</span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {(providers.length ? providers : Object.keys(platformLabels).map((id) => ({ id, status: 'planned' }))).map((provider) => (
            <div key={provider.id} className="rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{platformLabels[provider.id] || provider.label || provider.id}</span>
                <CircleDot className="h-4 w-4 text-amber-500" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Connexion à préparer</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">1. Analyse IA</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Images-clés, transcription audio et contexte de campagne sont transformés en propositions structurées. Moteur : {aiReady ? 'prêt' : 'à configurer'}.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">2. Validation humaine</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Facebook, Instagram, TikTok, LinkedIn et YouTube sont modifiables séparément avant approbation.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <Send className="h-5 w-5 text-primary" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">3. Publication contrôlée</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Toujours verrouillée : aucune approbation actuelle ne déclenche de publication sur un réseau externe.</p>
        </div>
      </section>

      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-800">
        <p className="font-semibold">Lot 2 sécurisé</p>
        <p className="mt-1 text-xs leading-5 opacity-80">Campagnes, dépôt média streamé, analyse IA structurée et validation réseau par réseau sont préparés côté code. Stockage média : {mediaReady ? 'prêt' : 'à initialiser'} · IA : {aiReady ? 'prête' : 'à configurer'} · publication externe : verrouillée.</p>
      </div>

      <CampaignWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={handleCreated}
        status={status.data}
      />

      <CampaignReview
        campaignId={selectedCampaignId}
        status={status.data}
        onClose={() => setSelectedCampaignId(null)}
        onChanged={refreshOverview}
      />
    </div>
  );
}
