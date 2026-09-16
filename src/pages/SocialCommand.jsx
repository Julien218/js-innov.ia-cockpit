import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, CalendarDays, CheckCircle2, Cloud, Database, Globe2, Instagram,
  Loader2, Megaphone, RefreshCw, Send, ShieldCheck, Sparkles, UploadCloud,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { socialApi } from '@/lib/socialApi';
import { cn } from '@/lib/utils';

const PLATFORM_META = {
  facebook: { label: 'Facebook', short: 'FB' },
  instagram: { label: 'Instagram', short: 'IG' },
  tiktok: { label: 'TikTok', short: 'TT' },
};

const tabs = [
  ['overview', 'Vue générale'],
  ['brands', 'Identités'],
  ['campaigns', 'Campagnes'],
  ['calendar', 'Calendrier'],
  ['accounts', 'Comptes'],
];

function StatCard({ icon: Icon, label, value, detail }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3"><Icon className="w-4 h-4" />{label}</div>
      <div className="text-3xl font-semibold tracking-tight">{value ?? '—'}</div>
      {detail && <div className="text-xs text-muted-foreground mt-2">{detail}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

const inputClass = 'w-full h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const areaClass = 'w-full min-h-24 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';

function Empty({ children }) {
  return <div className="border border-dashed border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export default function SocialCommand() {
  const [tab, setTab] = useState('overview');
  const [brandForm, setBrandForm] = useState({ name: '', canonical_url: '', project_id: '' });
  const [campaignForm, setCampaignForm] = useState({ name: '', brand_id: '', objective: '', audience: '', landing_url: '', channels: ['facebook','instagram','tiktok'], autonomy_mode: 'semi_auto', brief: '' });
  const queryClient = useQueryClient();

  const statusQuery = useQuery({ queryKey: ['social-command','status'], queryFn: socialApi.status, retry: false });
  const overviewQuery = useQuery({ queryKey: ['social-command','overview'], queryFn: socialApi.overview, retry: false });
  const brandsQuery = useQuery({ queryKey: ['social-command','brands'], queryFn: socialApi.brands, retry: false });
  const campaignsQuery = useQuery({ queryKey: ['social-command','campaigns'], queryFn: socialApi.campaigns, retry: false });
  const postsQuery = useQuery({ queryKey: ['social-command','posts'], queryFn: () => socialApi.posts(), retry: false });
  const accountsQuery = useQuery({ queryKey: ['social-command','accounts'], queryFn: socialApi.accounts, retry: false });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['social-command'] });

  const createBrand = useMutation({
    mutationFn: socialApi.createBrand,
    onSuccess: async (brand) => {
      setBrandForm({ name: '', canonical_url: '', project_id: '' });
      refresh();
      try { await socialApi.syncBrand(brand.id); } finally { refresh(); }
    },
  });

  const syncBrand = useMutation({ mutationFn: socialApi.syncBrand, onSuccess: refresh });
  const createCampaign = useMutation({
    mutationFn: socialApi.createCampaign,
    onSuccess: () => {
      setCampaignForm((current) => ({ ...current, name: '', objective: '', audience: '', landing_url: '', brief: '' }));
      refresh();
    },
  });
  const backup = useMutation({ mutationFn: socialApi.runBackup, onSuccess: refresh });

  const brands = brandsQuery.data || [];
  const campaigns = campaignsQuery.data || [];
  const posts = postsQuery.data || [];
  const accounts = accountsQuery.data || [];
  const overview = overviewQuery.data || {};
  const status = statusQuery.data || {};
  const firstError = statusQuery.error || overviewQuery.error || brandsQuery.error || campaignsQuery.error || postsQuery.error || accountsQuery.error;

  const calendarRows = useMemo(() => [...posts]
    .filter((post) => post.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)), [posts]);

  const toggleChannel = (channel) => {
    setCampaignForm((current) => ({
      ...current,
      channels: current.channels.includes(channel) ? current.channels.filter((item) => item !== channel) : [...current.channels, channel],
    }));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Elynea Social Command"
        subtitle="Campagnes multi-marques · identité des sites dédiée · validation · programmation · analytics"
        actions={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Actualiser</Button>}
      />

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex gap-3 items-start">
        <ShieldCheck className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">La charte du site dédié est la source de vérité.</p>
          <p className="text-xs text-muted-foreground">Avant chaque campagne, Elynea travaille avec le manifeste visuel versionné de la marque. Supabase reste la base maître ; Dropbox conserve les manifestes, assets et backups chiffrés.</p>
        </div>
      </div>

      {firstError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700">
          <strong>Social Command n'est pas encore initialisé dans la base.</strong>
          <div className="mt-1 text-xs">{firstError.message}</div>
          <div className="mt-2 text-xs text-muted-foreground">Appliquer la migration Social Command sur Supabase avant l'activation production.</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={cn('px-3 py-2 rounded-xl text-sm font-medium border transition-colors', tab === key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={Megaphone} label="Campagnes" value={overview.campaigns} detail={`${overview.active_campaigns || 0} actives`} />
            <StatCard icon={Sparkles} label="À valider" value={overview.awaiting_review} />
            <StatCard icon={CalendarDays} label="Programmées" value={overview.scheduled} />
            <StatCard icon={Send} label="Publiées" value={overview.published} />
            <StatCard icon={Activity} label="Conversions" value={overview.conversions} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><Database className="w-4 h-4" />Architecture active</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Base transactionnelle</span><Badge variant="outline">Supabase / PostgreSQL</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Dropbox</span><Badge variant="outline">{status.dropbox_configured ? 'Connecté' : 'À configurer'}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Backup chiffré</span><Badge variant="outline">{status.encrypted_backup_configured ? 'AES-256-GCM prêt' : 'Clé manquante'}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Publication automatique</span><Badge variant="outline" className={status.publish_enabled ? 'text-amber-600' : 'text-emerald-600'}>{status.publish_enabled ? 'Autorisée' : 'Verrouillée'}</Badge></div>
              </div>
              <Button className="mt-4" variant="outline" size="sm" onClick={() => backup.mutate()} disabled={backup.isPending || !status.encrypted_backup_configured}>
                {backup.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5 mr-1.5" />}Backup Dropbox chiffré
              </Button>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><Cloud className="w-4 h-4" />Connecteurs sociaux</h3>
              <div className="space-y-3">
                {['facebook','instagram','tiktok'].map((platform) => {
                  const connected = accounts.some((item) => item.provider === platform && item.connection_status === 'connected');
                  const providerReady = platform === 'tiktok' ? status.providers?.tiktok : status.providers?.meta;
                  return <div key={platform} className="flex items-center justify-between rounded-xl bg-muted/40 p-3"><span className="text-sm font-medium">{PLATFORM_META[platform].label}</span><div className="flex gap-2"><Badge variant="outline">{providerReady ? 'App configurée' : 'App OAuth à configurer'}</Badge><Badge variant="outline" className={connected ? 'text-emerald-600' : 'text-muted-foreground'}>{connected ? 'Compte connecté' : 'Non connecté'}</Badge></div></div>;
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-4">Aucune publication réelle ne part tant que OAuth n'est pas configuré et que le verrou SOCIAL_PUBLISH_ENABLED reste désactivé.</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'brands' && (
        <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4">
          <div className="bg-card border border-border rounded-2xl p-5 h-fit">
            <h3 className="font-semibold mb-4">Ajouter une identité</h3>
            <div className="space-y-3">
              <Field label="Nom de la marque"><input className={inputClass} value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} placeholder="Miss & Mister Dour" /></Field>
              <Field label="Site dédié — source visuelle"><input className={inputClass} value={brandForm.canonical_url} onChange={(e) => setBrandForm({ ...brandForm, canonical_url: e.target.value })} placeholder="https://missetmisterdour.be" /></Field>
              <Field label="ID projet Cockpit (optionnel)"><input className={inputClass} value={brandForm.project_id} onChange={(e) => setBrandForm({ ...brandForm, project_id: e.target.value })} /></Field>
              <Button className="w-full" onClick={() => createBrand.mutate(brandForm)} disabled={createBrand.isPending || !brandForm.name || !brandForm.canonical_url}>
                {createBrand.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Globe2 className="w-4 h-4 mr-2" />}Créer et synchroniser
              </Button>
              {createBrand.error && <p className="text-xs text-red-600">{createBrand.error.message}</p>}
            </div>
          </div>

          <div className="space-y-3">
            {!brands.length ? <Empty>Aucune identité de marque. Ajoute d'abord le site dédié.</Empty> : brands.map((brand) => (
              <div key={brand.id} className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2"><h3 className="font-semibold">{brand.name}</h3><Badge variant="outline">v{brand.manifest_version || 1}</Badge></div>
                    <a href={brand.canonical_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{brand.canonical_url}</a>
                    <p className="text-xs text-muted-foreground mt-2">Dernière synchronisation : {brand.last_synced_at ? new Date(brand.last_synced_at).toLocaleString('fr-BE') : 'jamais'}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => syncBrand.mutate(brand.id)} disabled={syncBrand.isPending}><RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', syncBrand.isPending && 'animate-spin')} />Synchroniser le site</Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(brand.manifest?.colors || []).slice(0, 10).map((color) => <span key={color} className="inline-flex items-center gap-1.5 text-[11px] rounded-full border px-2 py-1"><span className="w-3 h-3 rounded-full border" style={{ background: color }} />{color}</span>)}
                </div>
                {brand.manifest?.font_families?.length > 0 && <p className="text-xs text-muted-foreground mt-3">Typographies détectées : {brand.manifest.font_families.join(' · ')}</p>}
                {brand.dropbox_path && <p className="text-[11px] text-muted-foreground mt-2">Manifeste archivé : {brand.dropbox_path}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'campaigns' && (
        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
          <div className="bg-card border border-border rounded-2xl p-5 h-fit">
            <h3 className="font-semibold mb-4">Nouvelle campagne</h3>
            <div className="space-y-3">
              <Field label="Marque"><select className={inputClass} value={campaignForm.brand_id} onChange={(e) => setCampaignForm({ ...campaignForm, brand_id: e.target.value })}><option value="">Choisir…</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></Field>
              <Field label="Nom"><input className={inputClass} value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} placeholder="Recrutement 2027" /></Field>
              <Field label="Objectif"><input className={inputClass} value={campaignForm.objective} onChange={(e) => setCampaignForm({ ...campaignForm, objective: e.target.value })} placeholder="Recruter des candidats" /></Field>
              <Field label="Audience"><input className={inputClass} value={campaignForm.audience} onChange={(e) => setCampaignForm({ ...campaignForm, audience: e.target.value })} /></Field>
              <Field label="Landing page"><input className={inputClass} value={campaignForm.landing_url} onChange={(e) => setCampaignForm({ ...campaignForm, landing_url: e.target.value })} /></Field>
              <Field label="Réseaux"><div className="flex gap-2">{Object.keys(PLATFORM_META).map((platform) => <button type="button" key={platform} onClick={() => toggleChannel(platform)} className={cn('px-3 py-2 text-xs rounded-xl border', campaignForm.channels.includes(platform) ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground')}>{PLATFORM_META[platform].label}</button>)}</div></Field>
              <Field label="Autonomie"><select className={inputClass} value={campaignForm.autonomy_mode} onChange={(e) => setCampaignForm({ ...campaignForm, autonomy_mode: e.target.value })}><option value="assisted">Assisté</option><option value="semi_auto">Semi-automatique</option><option value="autopilot">Autopilote</option></select></Field>
              <Field label="Brief Elynea"><textarea className={areaClass} value={campaignForm.brief} onChange={(e) => setCampaignForm({ ...campaignForm, brief: e.target.value })} placeholder="Accroche, ambiance, contraintes…" /></Field>
              <Button className="w-full" onClick={() => createCampaign.mutate(campaignForm)} disabled={createCampaign.isPending || !campaignForm.brand_id || !campaignForm.name}><Sparkles className="w-4 h-4 mr-2" />Créer la campagne</Button>
              {createCampaign.error && <p className="text-xs text-red-600">{createCampaign.error.message}</p>}
            </div>
          </div>

          <div className="space-y-3">
            {!campaigns.length ? <Empty>Aucune campagne.</Empty> : campaigns.map((campaign) => {
              const brand = brands.find((item) => item.id === campaign.brand_id);
              return <div key={campaign.id} className="bg-card border border-border rounded-2xl p-5"><div className="flex items-start justify-between gap-4"><div><div className="flex gap-2 items-center flex-wrap"><h3 className="font-semibold">{campaign.name}</h3><Badge variant="outline">{campaign.status}</Badge><Badge variant="outline">{campaign.autonomy_mode}</Badge></div><p className="text-xs text-muted-foreground mt-1">{brand?.name || 'Marque'} · {campaign.objective || 'Objectif non défini'}</p></div><div className="flex gap-1">{(campaign.channels || []).map((channel) => <Badge key={channel} variant="outline">{PLATFORM_META[channel]?.short || channel}</Badge>)}</div></div>{campaign.brief && <p className="text-sm mt-4 bg-muted/40 rounded-xl p-3 whitespace-pre-wrap">{campaign.brief}</p>}<p className="text-[11px] text-muted-foreground mt-3">Identité visuelle liée au manifeste {brand ? `v${brand.manifest_version || 1}` : 'de la marque'}.</p></div>;
            })}
          </div>
        </div>
      )}

      {tab === 'calendar' && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><CalendarDays className="w-4 h-4" />Calendrier éditorial</h3>
          {!calendarRows.length ? <Empty>Les publications approuvées et programmées apparaîtront ici.</Empty> : <div className="space-y-2">{calendarRows.map((post) => <div key={post.id} className="grid grid-cols-[150px_90px_1fr_auto] gap-3 items-center rounded-xl border border-border p-3 text-sm"><div>{new Date(post.scheduled_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}</div><Badge variant="outline">{PLATFORM_META[post.platform]?.label || post.platform}</Badge><div className="truncate"><strong>{post.title || 'Publication'}</strong><div className="text-xs text-muted-foreground truncate">{post.caption}</div></div><Badge variant="outline">{post.status}</Badge></div>)}</div>}
        </div>
      )}

      {tab === 'accounts' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.keys(PLATFORM_META).map((platform) => {
            const rows = accounts.filter((item) => item.provider === platform);
            return <div key={platform} className="bg-card border border-border rounded-2xl p-5"><div className="flex items-center gap-2 mb-3">{platform === 'instagram' ? <Instagram className="w-4 h-4" /> : <Cloud className="w-4 h-4" />}<h3 className="font-semibold">{PLATFORM_META[platform].label}</h3></div>{rows.length ? rows.map((account) => <div key={account.id} className="rounded-xl bg-muted/40 p-3 mb-2"><div className="font-medium text-sm">{account.display_name || account.username || 'Compte'}</div><div className="text-xs text-muted-foreground">{account.connection_status}</div></div>) : <p className="text-xs text-muted-foreground">Aucun compte connecté.</p>}<p className="text-[11px] text-muted-foreground mt-4">OAuth sera activé uniquement lorsque l'application fournisseur et les scopes auront été validés.</p></div>;
          })}
        </div>
      )}
    </div>
  );
}
