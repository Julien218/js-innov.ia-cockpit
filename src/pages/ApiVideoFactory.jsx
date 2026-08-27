import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

const TEST_PROMPT = "Film de marque élégant pour JS-Innov.IA : fond bleu nuit, lignes lumineuses or et cyan formant un réseau d'intelligence connecté, mouvements cinématographiques fluides, composition premium et moderne, aucun visage, aucun logo tiers. Terminer sur une carte stable et très lisible avec uniquement « JS-Innov.IA » puis « L’IA qui transforme vos idées ». Format paysage 16:9, publicité professionnelle de huit secondes.";

function statusLabel(status) {
  return ({ queued: 'En file', submitted: 'Envoyée', in_progress: 'Génération', completed: 'Terminée', failed: 'Échec' })[status] || status;
}

function rejectedMessage(result, fallback) {
  return result.status === 'rejected'
    ? result.reason?.message || String(result.reason || fallback)
    : null;
}

export default function ApiVideoFactory() {
  const [config, setConfig] = useState(null);
  const [clients, setClients] = useState([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [clientId, setClientId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [provider, setProvider] = useState('auto');
  const [campaign, setCampaign] = useState('Identité JS-Innov.IA');
  const [prompt, setPrompt] = useState(TEST_PROMPT);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadWarning, setLoadWarning] = useState('');
  const [notice, setNotice] = useState(null);
  const selectedClient = useMemo(() => clients.find((client) => String(client.id) === String(clientId)), [clients, clientId]);

  const refresh = async () => {
    const [configurationResult, clientResult, jobResult] = await Promise.allSettled([
      fetchJson('/api/video-generation/config'),
      fetchJson('/api/client-costs/accounting/clients'),
      fetchJson('/api/video-generation/jobs'),
    ]);

    if (configurationResult.status === 'fulfilled') {
      setConfig(configurationResult.value);
    }

    if (clientResult.status === 'fulfilled') {
      setClients(Array.isArray(clientResult.value.clients) ? clientResult.value.clients : []);
      setClientsLoaded(true);
    } else {
      setClientsLoaded(true);
    }

    if (jobResult.status === 'fulfilled') {
      setJobs(Array.isArray(jobResult.value.jobs) ? jobResult.value.jobs : []);
    }

    const warnings = [
      rejectedMessage(configurationResult, 'configuration vidéo indisponible')
        ? `Configuration : ${rejectedMessage(configurationResult, 'configuration vidéo indisponible')}`
        : null,
      rejectedMessage(clientResult, 'clients indisponibles')
        ? `Clients : ${rejectedMessage(clientResult, 'clients indisponibles')}`
        : null,
      rejectedMessage(jobResult, 'historique indisponible')
        ? `Historique : ${rejectedMessage(jobResult, 'historique indisponible')}`
        : null,
    ].filter(Boolean);

    setLoadWarning(warnings.length
      ? `Chargement partiel — ${warnings.join(' · ')}. Les fonctions disponibles restent utilisables.`
      : '');
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!jobs.some((job) => ['queued', 'submitted', 'in_progress'].includes(job.status))) return undefined;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const createVideo = async () => {
    if (!selectedClient) return setNotice({ type: 'error', text: 'Sélectionne le client ou projet qui supportera le coût.' });
    setBusy(true); setNotice(null);
    try {
      const data = await fetchJson('/api/video-generation/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider, client_id: selectedClient.id, client_name: selectedClient.name,
          cost_center_id: costCenterId || null, campaign_name: campaign, prompt,
          sector: 'innovation numérique', rights_confirmed: rightsConfirmed,
        }),
      });
      setJobs((current) => [data.job, ...current]);
      setNotice({ type: 'success', text: `Génération lancée et journalisée : ${data.journal_id}` });
    } catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Fabrique vidéo API" subtitle="Générer, comptabiliser, vérifier et archiver dans un seul parcours" />

      <div className="grid gap-3 md:grid-cols-2">
        <div className={`workspace-card p-4 ${config?.providers?.xai?.available ? 'border-emerald-500/30' : ''}`}>
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><strong>Grok Imagine 1.5</strong></div>
          <p className="mt-2 text-sm text-muted-foreground">{config?.providers?.xai?.available ? 'Disponible · coût réel fourni par xAI' : 'Clé xAI non configurée dans Railway'}</p>
        </div>
        <div className={`workspace-card p-4 ${config?.providers?.openai?.available ? 'border-emerald-500/30' : ''}`}>
          <div className="flex items-center gap-2"><Cloud className="h-4 w-4 text-cyan-500" /><strong>Sora 2</strong></div>
          <p className="mt-2 text-sm text-muted-foreground">{config?.providers?.openai?.available ? 'Disponible temporairement · coût estimé sur tarif officiel' : 'Indisponible'}</p>
          <p className="mt-1 text-xs text-amber-600">API annoncée en fin de service le {config?.providers?.openai?.shutdown_date || '24/09/2026'}.</p>
        </div>
      </div>

      <section className="workspace-card space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">Client / projet comptable
            <select
              className="mt-1 w-full rounded-lg border bg-background p-2.5"
              value={clientId}
              disabled={!clientsLoaded || clients.length === 0}
              onChange={(event) => { setClientId(event.target.value); setCostCenterId(''); }}
            >
              <option value="">{!clientsLoaded ? 'Chargement…' : clients.length ? 'Sélectionner…' : 'Aucun client disponible'}</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Centre de coût
            <select className="mt-1 w-full rounded-lg border bg-background p-2.5" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
              <option value="">Client général</option>
              {(selectedClient?.cost_centers || []).map((center) => <option key={center.id} value={center.id}>{center.product_code}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Fournisseur
            <select className="mt-1 w-full rounded-lg border bg-background p-2.5" value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="auto">Automatique (Grok puis Sora)</option>
              <option value="grok">Grok Imagine</option>
              <option value="sora">Sora 2</option>
            </select>
          </label>
          <label className="text-sm font-medium">Campagne
            <input className="mt-1 w-full rounded-lg border bg-background p-2.5" value={campaign} onChange={(event) => setCampaign(event.target.value)} />
          </label>
        </div>
        <label className="block text-sm font-medium">Demande vidéo
          <textarea className="mt-1 min-h-36 w-full rounded-lg border bg-background p-3" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /> Les droits contractuels permettant la création et l’utilisation sont vérifiés.</label>
        {loadWarning && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">{loadWarning}</div>}
        {notice && <div className={`rounded-lg border p-3 text-sm ${notice.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-700' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'}`}>{notice.text}</div>}
        <Button onClick={createVideo} disabled={busy || !config || !selectedClient} className="w-full sm:w-auto">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Générer la vidéo test de 8 secondes
        </Button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Suivi et preuves</h2><Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-3.5 w-3.5" />Actualiser</Button></div>
        {jobs.length === 0 && <div className="workspace-card p-5 text-sm text-muted-foreground">Aucune génération API enregistrée.</div>}
        {jobs.map((job) => (
          <article key={job.id} className="workspace-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><strong>{job.client_name} — {job.campaign_name}</strong><p className="text-xs text-muted-foreground">{job.provider === 'xai' ? 'Grok' : 'Sora'} · {job.id}</p></div>
              <span className="rounded-full border px-2.5 py-1 text-xs">{statusLabel(job.status)} {job.progress ? `· ${job.progress}%` : ''}</span>
            </div>
            {job.error && <p className="mt-3 flex gap-2 text-sm text-red-600"><AlertTriangle className="h-4 w-4 shrink-0" />{job.error}</p>}
            {job.status === 'completed' && <div className="mt-3 space-y-1 text-sm text-emerald-700"><p className="flex gap-2"><CheckCircle2 className="h-4 w-4" />MP4 et JSON vérifiés puis archivés.</p><p>Dropbox : {job.dropbox_path}</p><p>Coût : {(Number(job.cost_eur_minor || 0) / 100).toFixed(2)} € · preuve {job.cost_evidence_status}</p><p className="break-all text-xs">SHA-256 : {job.sha256}</p></div>}
          </article>
        ))}
      </section>
    </div>
  );
}
