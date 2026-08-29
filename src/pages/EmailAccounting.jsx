import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Clock3, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';

const euro = (minor) => Number.isFinite(Number(minor)) ? `${(Number(minor) / 100).toFixed(2).replace('.', ',')} €` : 'À vérifier';

async function api(path, options = {}) {
  const response = await fetch(`/api/email-accounting${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function Stat({ icon: Icon, label, value, color = 'text-[#D4AF37]' }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><Icon className={`h-5 w-5 ${color}`} /><div className="mt-3 text-2xl font-semibold text-white">{value}</div><div className="text-xs text-slate-400">{label}</div></div>;
}

export default function EmailAccounting() {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    setError('');
    try {
      const [state, pending, clientResponse] = await Promise.all([
        api('/status'),
        api('/items?status=awaiting_review'),
        fetch('/api/data/Client?limit=2000', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : []),
      ]);
      setStatus(state);
      setItems(pending.items || []);
      setClients(Array.isArray(clientResponse) ? clientResponse : (clientResponse.data || clientResponse.items || []));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const archived = useMemo(() => items.filter((item) => item.document_id).length, [items]);
  const updateDraft = (id, patch) => setDrafts((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));

  const runNow = async () => {
    setRunning(true); setError('');
    try { await api('/run', { method: 'POST', body: JSON.stringify({ send_report: true }) }); await load(); }
    catch (err) { setError(err.message); }
    finally { setRunning(false); }
  };

  const review = async (item, decision) => {
    const draft = drafts[item.id] || {};
    setError('');
    try {
      await api(`/items/${item.id}/review`, { method: 'POST', body: JSON.stringify({ decision, client_id: draft.client_id || null, project_id: draft.project_id || null, amount_minor: draft.amount_minor ? Math.round(Number(String(draft.amount_minor).replace(',', '.')) * 100) : item.amount_minor }) });
      await load();
    } catch (err) { setError(err.message); }
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <div className="rounded-3xl border border-[#D4AF37]/20 bg-gradient-to-br from-[#171324] to-[#0a0a14] p-6 shadow-2xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div><div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-1 text-xs text-[#F4D97C]"><ShieldCheck className="h-4 w-4" /> Contrôle humain obligatoire</div><h1 className="text-2xl font-semibold text-white">NOVA — Assistant comptable e-mail</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Tri quotidien des boîtes JS‑Innov.IA et Assurances Dour, archivage Dropbox et préparation d’AI Cost Control. Aucun e-mail n’est supprimé.</p></div>
        <button onClick={runNow} disabled={running} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-3 font-medium text-black disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />{running ? 'Analyse en cours…' : 'Analyser et envoyer le rapport'}</button>
      </div>
    </div>

    {error && <div className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200"><AlertTriangle className="h-5 w-5" />{error}</div>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon={Clock3} label="En attente de validation" value={status?.pending_reviews ?? '—'} />
      <Stat icon={Archive} label="Pièces déjà archivées" value={archived} color="text-cyan-300" />
      <Stat icon={MailCheck} label="Rapport quotidien" value={status?.last_report?.status === 'sent' ? 'Envoyé' : 'À venir'} color="text-emerald-300" />
      <Stat icon={CheckCircle2} label="Heure planifiée" value={`${status?.report_hour ?? 18} h`} color="text-violet-300" />
    </div>

    <section className="rounded-2xl border border-white/10 bg-[#0d0d18] p-4 sm:p-5">
      <div className="mb-4"><h2 className="font-semibold text-white">Éléments à valider</h2><p className="text-xs text-slate-500">NOVA propose ; vous confirmez le client, le montant et l’imputation comptable.</p></div>
      {loading ? <div className="py-10 text-center text-slate-400">Chargement…</div> : items.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-slate-400">Aucun e-mail incertain en attente.</div> : <div className="space-y-3">{items.map((item) => {
        const draft = drafts[item.id] || {};
        return <article key={item.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#D4AF37]/10 px-2 py-1 text-[11px] text-[#F4D97C]">{item.category}</span>{item.document_id && <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200">Dropbox archivé</span>}</div><h3 className="mt-2 truncate font-medium text-white">{item.subject}</h3><p className="truncate text-xs text-slate-400">{item.sender}</p><p className="mt-1 text-xs text-slate-500">{item.provider || 'Fournisseur à identifier'} · {euro(item.amount_minor)} · confiance {Math.round(Number(item.confidence || 0) * 100)} %</p></div>
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-[520px] lg:grid-cols-3"><select value={draft.client_id || ''} onChange={(event) => updateDraft(item.id, { client_id: event.target.value })} className="rounded-lg border border-white/10 bg-[#151522] px-3 py-2 text-sm text-white"><option value="">Choisir le client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nom || client.raison_sociale || client.email || client.id}</option>)}</select><input value={draft.amount_minor || ''} onChange={(event) => updateDraft(item.id, { amount_minor: event.target.value })} placeholder={item.amount_minor ? (item.amount_minor / 100).toFixed(2) : 'Montant EUR'} className="rounded-lg border border-white/10 bg-[#151522] px-3 py-2 text-sm text-white" /><button onClick={() => review(item, 'import_cost')} className="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-medium text-black">Valider dans AI Cost</button><button onClick={() => review(item, 'archive_only')} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200">Archiver seulement</button><button onClick={() => review(item, 'ignore')} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">Ignorer</button></div></div>
        </article>;
      })}</div>}
    </section>
  </div>;
}
