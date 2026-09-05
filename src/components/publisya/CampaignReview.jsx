import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileImage,
  Loader2,
  PencilLine,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  analyzePublisyaCampaign,
  approvePublisyaCampaign,
  getPublisyaCampaign,
  requestPublisyaChanges,
  updatePublisyaVariant,
} from '@/lib/publisyaClient';

const NETWORKS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
];

const STATUS_LABELS = {
  draft: 'Brouillon',
  analyzing: 'Analyse en cours',
  generated: 'Généré',
  awaiting_approval: 'À valider',
  needs_changes: 'Corrections demandées',
  approved: 'Approuvé',
  scheduled: 'Programmé',
  publishing: 'Publication',
  published: 'Publié',
  partially_published: 'Publication partielle',
  failed: 'Erreur',
  canceled: 'Annulé',
  expired: 'Expiré',
};

function listToText(values) {
  return Array.isArray(values) ? values.join(' ') : '';
}

function textToList(value) {
  return [...new Set(String(value || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function latestVariants(rows = []) {
  const byPlatform = new Map();
  for (const row of rows) {
    const current = byPlatform.get(row.platform);
    if (!current || Number(row.version || 0) > Number(current.version || 0)) {
      byPlatform.set(row.platform, row);
    }
  }
  return byPlatform;
}

function formFromVariant(variant) {
  if (!variant) return {};
  if (variant.platform === 'youtube') {
    return {
      title: variant.title || '',
      description: variant.description || '',
      tags: listToText(variant.tags),
      cover_text: variant.cover_text || '',
    };
  }
  return {
    caption: variant.caption || '',
    hashtags: listToText(variant.hashtags),
    call_to_action: variant.call_to_action || '',
    alt_text: variant.alt_text || '',
    cover_text: variant.cover_text || '',
    hook: variant.provider_options?.hook || '',
  };
}

function payloadFromForm(platform, form) {
  if (platform === 'youtube') {
    return {
      title: form.title || '',
      description: form.description || '',
      tags: textToList(form.tags),
      cover_text: form.cover_text || '',
    };
  }
  return {
    caption: form.caption || '',
    hashtags: textToList(form.hashtags),
    call_to_action: form.call_to_action || '',
    alt_text: form.alt_text || '',
    cover_text: form.cover_text || '',
    hook: form.hook || '',
  };
}

function MediaSummary({ media }) {
  if (!media) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Aucun média source enregistré pour cette campagne.
      </div>
    );
  }
  const name = media.media_metadata?.original_filename || String(media.storage_key || '').split('/').pop() || 'Média source';
  const sizeMb = Number(media.file_size_bytes || 0) / 1024 / 1024;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/20 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileImage className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {media.mime_type || 'média'}{sizeMb > 0 ? ` · ${sizeMb.toFixed(sizeMb > 10 ? 1 : 2)} Mo` : ''}
        </p>
      </div>
      {media.sha256 && <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">SHA {media.sha256.slice(0, 10)}…</span>}
    </div>
  );
}

function VariantEditor({ variant, form, onChange, disabled }) {
  if (!variant) return null;
  const set = (key) => (event) => onChange({ ...form, [key]: event.target.value });

  if (variant.platform === 'youtube') {
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor="publisya-youtube-title">Titre YouTube</label>
          <Input id="publisya-youtube-title" value={form.title || ''} onChange={set('title')} maxLength={200} disabled={disabled} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor="publisya-youtube-description">Description</label>
          <Textarea id="publisya-youtube-description" value={form.description || ''} onChange={set('description')} rows={7} maxLength={5000} disabled={disabled} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor="publisya-youtube-tags">Tags</label>
          <Input id="publisya-youtube-tags" value={form.tags || ''} onChange={set('tags')} placeholder="assurance dour conseils" disabled={disabled} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor="publisya-youtube-cover">Texte de miniature</label>
          <Input id="publisya-youtube-cover" value={form.cover_text || ''} onChange={set('cover_text')} maxLength={120} disabled={disabled} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {variant.platform === 'tiktok' && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor="publisya-tiktok-hook">Accroche</label>
          <Input id="publisya-tiktok-hook" value={form.hook || ''} onChange={set('hook')} maxLength={240} disabled={disabled} />
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor={`publisya-caption-${variant.platform}`}>Publication</label>
        <Textarea id={`publisya-caption-${variant.platform}`} value={form.caption || ''} onChange={set('caption')} rows={8} maxLength={5000} disabled={disabled} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor={`publisya-hashtags-${variant.platform}`}>Hashtags</label>
        <Input id={`publisya-hashtags-${variant.platform}`} value={form.hashtags || ''} onChange={set('hashtags')} placeholder="#Dour #CommerceLocal" disabled={disabled} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor={`publisya-cta-${variant.platform}`}>Appel à l’action</label>
          <Input id={`publisya-cta-${variant.platform}`} value={form.call_to_action || ''} onChange={set('call_to_action')} maxLength={500} disabled={disabled} />
        </div>
        {(variant.platform === 'instagram' || variant.platform === 'tiktok') && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor={`publisya-cover-${variant.platform}`}>Texte couverture</label>
            <Input id={`publisya-cover-${variant.platform}`} value={form.cover_text || ''} onChange={set('cover_text')} maxLength={240} disabled={disabled} />
          </div>
        )}
      </div>
      {(variant.platform === 'facebook' || variant.platform === 'instagram') && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor={`publisya-alt-${variant.platform}`}>Texte alternatif</label>
          <Textarea id={`publisya-alt-${variant.platform}`} value={form.alt_text || ''} onChange={set('alt_text')} rows={2} maxLength={1000} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

export default function CampaignReview({ campaignId, status, onClose, onChanged }) {
  const queryClient = useQueryClient();
  const [selectedPlatform, setSelectedPlatform] = useState('facebook');
  const [form, setForm] = useState({});
  const [reviewComment, setReviewComment] = useState('');
  const [localError, setLocalError] = useState('');

  const detail = useQuery({
    queryKey: ['publisya', 'campaign', campaignId],
    queryFn: () => getPublisyaCampaign(campaignId),
    enabled: Boolean(campaignId),
    staleTime: 5_000,
  });

  const latest = useMemo(() => latestVariants(detail.data?.variants || []), [detail.data?.variants]);
  const campaign = detail.data?.campaign;
  const media = (detail.data?.media || []).find((item) => item.asset_role === 'source') || detail.data?.media?.[0] || null;
  const targetPlatforms = useMemo(
    () => Array.isArray(campaign?.target_platforms) ? campaign.target_platforms.filter((id) => NETWORKS.some((item) => item.id === id)) : [],
    [campaign?.target_platforms],
  );
  const currentVariant = latest.get(selectedPlatform) || null;
  const reviewable = ['awaiting_approval', 'needs_changes'].includes(campaign?.status);
  const approved = campaign?.status === 'approved';
  const analysisAvailable = Boolean(status?.capabilities?.ai_analysis);
  const canAnalyze = Boolean(media && analysisAvailable && campaign && !['scheduled', 'publishing', 'published'].includes(campaign.status));
  const allTargetsReady = targetPlatforms.length > 0 && targetPlatforms.every((platform) => latest.has(platform));

  useEffect(() => {
    if (!targetPlatforms.length) return;
    if (!targetPlatforms.includes(selectedPlatform)) setSelectedPlatform(targetPlatforms[0]);
  }, [selectedPlatform, targetPlatforms]);

  useEffect(() => {
    setForm(formFromVariant(currentVariant));
    setLocalError('');
  }, [currentVariant?.id, currentVariant?.updated_at]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['publisya', 'campaign', campaignId] });
    queryClient.invalidateQueries({ queryKey: ['publisya', 'campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['publisya', 'dashboard'] });
    onChanged?.();
  };

  const analyzeMutation = useMutation({
    mutationFn: () => analyzePublisyaCampaign(campaignId),
    onSuccess: refreshAll,
    onError: (error) => setLocalError(error.message || 'Analyse impossible.'),
  });

  const saveMutation = useMutation({
    mutationFn: () => updatePublisyaVariant(campaignId, currentVariant.id, payloadFromForm(currentVariant.platform, form)),
    onSuccess: refreshAll,
    onError: (error) => setLocalError(error.message || 'Enregistrement impossible.'),
  });

  const approveMutation = useMutation({
    mutationFn: () => approvePublisyaCampaign(campaignId, reviewComment),
    onSuccess: () => {
      setReviewComment('');
      refreshAll();
    },
    onError: (error) => setLocalError(error.message || 'Validation impossible.'),
  });

  const changesMutation = useMutation({
    mutationFn: () => requestPublisyaChanges(campaignId, reviewComment),
    onSuccess: () => {
      setReviewComment('');
      refreshAll();
    },
    onError: (error) => setLocalError(error.message || 'Demande de correction impossible.'),
  });

  if (!campaignId) return null;
  const busy = analyzeMutation.isPending || saveMutation.isPending || approveMutation.isPending || changesMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55" role="dialog" aria-modal="true" aria-label="Validation de la campagne Publisya">
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-card px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Publisya · validation humaine</p>
            <h2 className="mt-1 truncate text-xl font-bold text-foreground">{campaign?.title || 'Campagne'}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2.5 py-1">{STATUS_LABELS[campaign?.status] || campaign?.status || 'Chargement'}</span>
              <span className="flex items-center gap-1 text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Validation obligatoire</span>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {detail.isLoading ? (
            <div className="flex min-h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement de la campagne…</div>
          ) : detail.isError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700">{detail.error?.message || 'Impossible de charger cette campagne.'}</div>
          ) : (
            <div className="space-y-6">
              <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
                <MediaSummary media={media} />
                <Button
                  onClick={() => { setLocalError(''); analyzeMutation.mutate(); }}
                  disabled={!canAnalyze || analyzeMutation.isPending || approved}
                  variant={reviewable ? 'outline' : 'default'}
                  className="h-auto min-h-12 whitespace-nowrap"
                  title={!media ? 'Ajoutez un média source' : !analysisAvailable ? 'Moteur IA non configuré' : undefined}
                >
                  {analyzeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : reviewable ? <RefreshCw className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {reviewable ? 'Régénérer les propositions' : 'Analyser avec l’IA'}
                </Button>
              </section>

              {!analysisAvailable && media && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-800">
                  Le média est prêt, mais le moteur IA Publisya n’est pas encore disponible dans cet environnement.
                </div>
              )}

              {Array.isArray(campaign?.risk_flags) && campaign.risk_flags.length > 0 && (
                <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" /> Points à vérifier avant validation</div>
                  <ul className="mt-2 space-y-1 text-sm text-amber-900/80">
                    {campaign.risk_flags.map((flag, index) => <li key={`${flag}-${index}`}>• {flag}</li>)}
                  </ul>
                </section>
              )}

              {campaign?.analysis?.summary && (
                <section className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Analyse du contenu</p>
                  <p className="mt-2 text-sm leading-6 text-foreground">{campaign.analysis.summary}</p>
                  {campaign.analysis.transcript && (
                    <details className="mt-3 rounded-xl bg-muted/40 p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Voir la transcription</summary>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{campaign.analysis.transcript}</p>
                    </details>
                  )}
                </section>
              )}

              {latest.size > 0 ? (
                <section className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="border-b border-border p-3">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {NETWORKS.filter((network) => targetPlatforms.includes(network.id)).map((network) => {
                        const variant = latest.get(network.id);
                        const active = selectedPlatform === network.id;
                        return (
                          <button
                            key={network.id}
                            type="button"
                            onClick={() => setSelectedPlatform(network.id)}
                            className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                          >
                            {network.label}
                            {variant?.status === 'approved' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    {currentVariant ? (
                      <>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Version {currentVariant.version} · {NETWORKS.find((item) => item.id === currentVariant.platform)?.label}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{currentVariant.generated_by || 'Proposition générée'}</p>
                          </div>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">{currentVariant.status === 'approved' ? 'Approuvée' : 'À relire'}</span>
                        </div>
                        <VariantEditor variant={currentVariant} form={form} onChange={setForm} disabled={!reviewable || busy} />
                        {reviewable && (
                          <div className="mt-5 flex justify-end border-t border-border pt-4">
                            <Button variant="outline" onClick={() => { setLocalError(''); saveMutation.mutate(); }} disabled={busy}>
                              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                              Enregistrer cette version
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-8 text-center text-sm text-muted-foreground">Aucune proposition générée pour ce réseau.</div>
                    )}
                  </div>
                </section>
              ) : (
                <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                  <PencilLine className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-semibold text-foreground">Aucune version réseau générée</p>
                  <p className="mt-1 text-xs text-muted-foreground">L’analyse IA créera les propositions adaptées aux réseaux sélectionnés.</p>
                </section>
              )}

              {localError && <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700">{localError}</div>}

              {(reviewable || approved) && (
                <section className="rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-foreground">Contrôle humain</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Valider cette campagne verrouille les versions approuvées. Cela ne publie rien : les connexions sociales et le scheduler restent désactivés dans ce lot.
                      </p>
                    </div>
                  </div>

                  {reviewable && (
                    <>
                      <Textarea
                        value={reviewComment}
                        onChange={(event) => setReviewComment(event.target.value)}
                        rows={2}
                        maxLength={2000}
                        placeholder="Commentaire de validation ou corrections demandées (facultatif)"
                        className="mt-4 bg-background"
                        disabled={busy}
                      />
                      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => { setLocalError(''); changesMutation.mutate(); }} disabled={busy}>
                          {changesMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PencilLine className="mr-2 h-4 w-4" />}
                          Demander des corrections
                        </Button>
                        <Button onClick={() => { setLocalError(''); approveMutation.mutate(); }} disabled={busy || !allTargetsReady}>
                          {approveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          Approuver la campagne
                        </Button>
                      </div>
                    </>
                  )}

                  {approved && (
                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" /> Campagne approuvée · aucune publication externe déclenchée
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
