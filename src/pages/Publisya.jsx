import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
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
import { getPublisyaDashboard, getPublisyaStatus } from '@/lib/publisyaClient';

const platformLabels = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
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

export default function Publisya() {
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

  const providers = status.data?.providers || [];
  const campaigns = dashboard.data?.campaigns || {};
  const connected = dashboard.data?.connections?.connected || 0;
  const isFoundationMode = status.data?.publishing_enabled === false;
  const apiError = status.isError || dashboard.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Publisya"
        subtitle="Un contenu. Chaque réseau. Le bon message."
        search=""
        onSearch={() => {}}
        actions={
          <Button disabled title="Disponible au Lot 2 : import et analyse IA">
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
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700">Fondation sécurisée</span>
              )}
            </div>
            <h2 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">Votre diffusion sociale, centralisée dans le Cockpit.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Déposez une image ou une vidéo, Publisya l’analysera puis préparera une version adaptée à chaque réseau. La publication restera soumise à validation humaine par défaut.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={FileVideo2}
          label="Campagnes"
          value={(campaigns.draft || 0) + (campaigns.awaiting_approval || 0) + (campaigns.scheduled || 0)}
          detail="Brouillons, validations et publications programmées"
        />
        <MetricCard
          icon={ShieldCheck}
          label="À valider"
          value={campaigns.awaiting_approval || 0}
          detail="Aucune publication ne part sans autorisation"
        />
        <MetricCard
          icon={CalendarClock}
          label="Programmées"
          value={campaigns.scheduled || 0}
          detail="Fuseau par défaut : Europe/Brussels"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Comptes connectés"
          value={`${connected}/${providers.length || 5}`}
          detail="Connexions OAuth officielles prévues au Lot 3"
        />
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Réseaux pris en charge</h3>
            <p className="mt-1 text-sm text-muted-foreground">Chaque connecteur restera indépendant afin qu’une erreur sur un réseau ne bloque pas les autres.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">Publication réelle désactivée au Lot 1</span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {(providers.length ? providers : Object.keys(platformLabels).map(id => ({ id, status: 'planned' }))).map(provider => (
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
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Analyse du média, de l’ADN de marque, du message et des contraintes techniques.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">2. Validation humaine</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Aperçu et correction séparés pour Facebook, Instagram, TikTok, LinkedIn et YouTube.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <Send className="h-5 w-5 text-primary" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">3. Publication contrôlée</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Programmation et publication avec historique, idempotence et suivi des erreurs par réseau.</p>
        </div>
      </section>

      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-800">
        <p className="font-semibold">Lot 1 sécurisé</p>
        <p className="mt-1 text-xs leading-5 opacity-80">Le module est préparé pour le Cockpit, mais les uploads, l’IA, la programmation et les publications externes restent volontairement désactivés tant que leurs couches de sécurité et de validation ne sont pas terminées.</p>
      </div>
    </div>
  );
}
