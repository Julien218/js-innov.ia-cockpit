import { useMemo, useState } from 'react';
import { Check, FileImage, Loader2, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createPublisyaCampaign, uploadPublisyaMedia } from '@/lib/publisyaClient';

const NETWORKS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
];

const MAX_FILE_BYTES = 140 * 1024 * 1024;

export default function CampaignWizard({ open, onClose, onCreated, status }) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [instructions, setInstructions] = useState('');
  const [platforms, setPlatforms] = useState(NETWORKS.map((network) => network.id));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const databaseReady = Boolean(status?.infrastructure?.database_ready);
  const mediaReady = Boolean(status?.capabilities?.media_upload);
  const canSubmit = databaseReady && title.trim() && platforms.length > 0 && !busy;
  const fileSummary = useMemo(() => {
    if (!file) return null;
    return `${file.name} · ${(file.size / 1024 / 1024).toFixed(file.size > 10 * 1024 * 1024 ? 1 : 2)} Mo`;
  }, [file]);

  if (!open) return null;

  const togglePlatform = (id) => {
    setPlatforms((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const chooseFile = (event) => {
    const next = event.target.files?.[0] || null;
    setError('');
    if (next && next.size > MAX_FILE_BYTES) {
      setFile(null);
      setError('Le média dépasse 140 Mo.');
      return;
    }
    if (next && !/^(image|video)\//i.test(next.type || '')) {
      setFile(null);
      setError('Sélectionnez une image ou une vidéo.');
      return;
    }
    setFile(next);
  };

  const reset = () => {
    setTitle('');
    setObjective('');
    setInstructions('');
    setPlatforms(NETWORKS.map((network) => network.id));
    setFile(null);
    setBusy(false);
    setProgress(0);
    setError('');
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose?.();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (file && !mediaReady) {
      setError('Le stockage média doit être initialisé avant de pouvoir joindre ce fichier. Vous pouvez créer la campagne sans média.');
      return;
    }

    setBusy(true);
    setProgress(10);
    setError('');
    try {
      const created = await createPublisyaCampaign({
        title: title.trim(),
        objective: objective.trim(),
        instructions: instructions.trim(),
        target_platforms: platforms,
      });
      const campaign = created.campaign;
      setProgress(file ? 25 : 100);
      if (file) await uploadPublisyaMedia(campaign.id, file, (value) => setProgress(Math.max(25, value)));
      onCreated?.(campaign);
      reset();
      onClose?.();
    } catch (submitError) {
      setError(submitError.message || 'Impossible de créer cette campagne.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Nouvelle campagne Publisya">
      <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Publisya</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">Nouveau contenu</h2>
            <p className="mt-1 text-sm text-muted-foreground">Crée la campagne, puis dépose le média source. Aucune publication externe n’est déclenchée.</p>
          </div>
          <button type="button" onClick={close} disabled={busy} className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!databaseReady && (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-800">
            La migration Publisya n’est pas encore appliquée sur la base de données. La création reste bloquée afin d’éviter un enregistrement incomplet.
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="publisya-title">Titre de la campagne</label>
            <Input id="publisya-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Ex. Présentation de notre nouveau service" disabled={busy} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="publisya-objective">Objectif</label>
            <Input id="publisya-objective" value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={500} placeholder="Ex. Générer des demandes de contact locales" disabled={busy} />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Réseaux</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {NETWORKS.map((network) => {
                const active = platforms.includes(network.id);
                return (
                  <button
                    key={network.id}
                    type="button"
                    onClick={() => togglePlatform(network.id)}
                    disabled={busy}
                    className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted'}`}
                  >
                    {active && <Check className="h-3.5 w-3.5" />}
                    {network.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="publisya-instructions">Consignes supplémentaires</label>
            <Textarea id="publisya-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000} rows={3} placeholder="Ex. Ton humain, local, tutoiement interdit, mettre le site en avant…" disabled={busy} />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Image ou vidéo source</p>
            <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed p-4 transition ${mediaReady ? 'border-primary/30 bg-primary/5 hover:bg-primary/10' : 'border-border bg-muted/20 opacity-70'}`}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
                {file ? <FileImage className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{fileSummary || (mediaReady ? 'Choisir un média' : 'Stockage média non initialisé')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Image ou vidéo · maximum 140 Mo</p>
              </div>
              <input type="file" accept="image/*,video/*" onChange={chooseFile} disabled={!mediaReady || busy} className="hidden" />
            </label>
          </div>

          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700">{error}</div>}

          {busy && (
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Enregistrement sécurisé</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={close} disabled={busy}>Annuler</Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              {file ? 'Créer et déposer' : 'Créer la campagne'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
