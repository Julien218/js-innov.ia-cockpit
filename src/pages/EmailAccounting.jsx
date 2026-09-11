import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Clock3, Eye, Languages, Loader2, MailCheck, Paperclip, RefreshCw, ShieldCheck, X } from 'lucide-react';

const euro = (minor) => Number.isFinite(Number(minor)) ? `${(Number(minor) / 100).toFixed(2).replace('.', ',')} €` : 'À vérifier';

const htmlToText = (html) => String(html || '')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:p|div|section|article|header|footer|h[1-6]|li|tr|blockquote|pre|details|summary)>/gi, '\n')
  .replace(/<\/(?:td|th)>/gi, ' · ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const cleanPlainEmail = (text) => String(text || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<relative-time[^>]*>([\s\S]*?)<\/relative-time>/gi, '$1')
  .replace(/<\/?(?:details|summary|br)\b[^>]*>/gi, '\n')
  .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
  .replace(/^\s*\|\s*/gm, '')
  .replace(/\s*\|\s*$/gm, '')
  .replace(/\s*\|\s*/g, ' · ')
  .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, '$1 — $2')
  .replace(/\\([*_`#[\]<>])/g, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const emailHtmlDocument = (html) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:">
<meta name="referrer" content="no-referrer">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #11111b; color: #e2e8f0; }
  body { padding: 20px; font: 14px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
  a { color: #67e8f9; }
  table { max-width: 100% !important; border-collapse: collapse; }
  td, th { padding: 6px; vertical-align: top; }
  img { max-width: 100% !important; height: auto !important; }
  pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
</style></head><body>${String(html || '')}</body></html>`;

const formatBytes = (bytes = 0) => bytes < 1024 ? `${bytes} o` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} Ko` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;

function MessageModal({ item, message, loading, error, onClose }) {
  const [translation, setTranslation] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);

  useEffect(() => {
    setTranslation(null);
    setTranslating(false);
    setTranslationError('');
    setShowTranslation(false);
  }, [item?.id]);

  if (!item) return null;
  const hasHtml = Boolean(String(message?.html || '').trim());
  const body = cleanPlainEmail(message?.text) || htmlToText(message?.html) || cleanPlainEmail(message?.preview);
  const translate = async () => {
    setTranslating(true); setTranslationError('');
    try {
      const result = await api(`/items/${item.id}/translate`, { method: 'POST', body: JSON.stringify({ target_language: 'fr-BE' }) });
      setTranslation(result.translation);
      setShowTranslation(true);
    } catch (translateError) { setTranslationError(translateError.message); }
    finally { setTranslating(false); }
  };
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Contenu de l’e-mail">
    <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl border border-white/10 bg-[#11111b] shadow-2xl sm:rounded-2xl">
      <div className="flex items-start gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-wide text-[#D4AF37]">E-mail source · lecture seule</p><h2 className="mt-1 text-base font-semibold text-white">{message?.subject || item.subject || '(sans objet)'}</h2>{message && <div className="mt-2 space-y-0.5 text-xs text-slate-400"><p><span className="text-slate-500">De :</span> {message.from || item.sender}</p>{message.to && <p><span className="text-slate-500">À :</span> {message.to}</p>}{message.date && <p>{new Date(message.date).toLocaleString('fr-BE')}</p>}</div>}</div>
        <div className="flex shrink-0 items-center gap-2">{message && <button onClick={translation ? () => setShowTranslation((value) => !value) : translate} disabled={translating} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/30 px-2.5 py-2 text-xs text-[#F4D97C] hover:bg-[#D4AF37]/10 disabled:opacity-60"><Languages className="h-4 w-4" />{translating ? 'Traduction…' : translation ? (showTranslation ? 'Voir l’original' : 'Voir en français') : 'Traduire en français'}</button>}<button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Fermer"><X className="h-5 w-5" /></button></div>
      </div>
      <div className="min-h-[240px] flex-1 overflow-y-auto p-4 sm:p-6">
        {loading && <div className="flex h-48 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Ouverture du message…</div>}
        {error && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
        {translationError && <div className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{translationError}</div>}
        {!loading && !error && <>{showTranslation && translation
          ? <div><div className="mb-3 flex flex-wrap items-center gap-2"><span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200">Traduction française</span>{translation.cached && <span className="text-[11px] text-slate-500">traduction déjà enregistrée · aucun nouveau coût</span>}{translation.cost_logged && <span className="text-[11px] text-slate-500">usage ajouté à AI Cost Control</span>}</div><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-200">{translation.text}</pre></div>
          : hasHtml
          ? <iframe title="Aperçu sécurisé de l’e-mail" sandbox="" referrerPolicy="no-referrer" srcDoc={emailHtmlDocument(message.html)} className="h-[52vh] min-h-[320px] w-full rounded-xl border border-white/10 bg-[#11111b]" />
          : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-200">{body || 'Corps du message vide ou indisponible.'}</pre>}
          {!showTranslation && hasHtml && <p className="mt-2 text-[11px] text-slate-500">Aperçu sécurisé : scripts, formulaires et images externes bloqués.</p>}
          {message?.attachments?.length > 0 && <div className="mt-6 border-t border-white/10 pt-4"><p className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400"><Paperclip className="h-4 w-4" />Pièces jointes ({message.attachments.length})</p><div className="space-y-2">{message.attachments.map((attachment, index) => <div key={`${attachment.filename}-${index}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs"><Paperclip className="h-4 w-4 text-[#D4AF37]" /><span className="min-w-0 flex-1 truncate text-slate-200">{attachment.filename}</span><span className="text-slate-500">{formatBytes(attachment.size)}</span>{attachment.archived && <span className="rounded bg-cyan-400/10 px-2 py-0.5 text-cyan-200">Dropbox</span>}</div>)}</div></div>}</>}
      </div>
    </div>
  </div>;
}

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
  const [selectedItem, setSelectedItem] = useState(null);
  const [messageDetail, setMessageDetail] = useState(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState('');

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

  const archived = status?.last_report?.counters?.archived ?? items.filter((item) => item.document_id).length;
  const mailboxFailures = useMemo(() => Object.entries(status?.mailbox_health || {}).filter(([, mailbox]) => mailbox?.status === 'failed'), [status]);
  const reportLabel = status?.last_report?.status === 'sent' ? 'Envoyé' : status?.last_report?.status === 'failed' ? 'Échec' : status?.last_report?.status === 'pending' ? 'En attente' : 'À venir';
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

  const openMessage = async (item) => {
    setSelectedItem(item); setMessageDetail(null); setMessageError(''); setMessageLoading(true);
    try {
      const response = await api(`/items/${item.id}/message`);
      setMessageDetail(response.email || null);
    } catch (err) { setMessageError(err.message); }
    finally { setMessageLoading(false); }
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <div className="rounded-3xl border border-[#D4AF37]/20 bg-gradient-to-br from-[#171324] to-[#0a0a14] p-6 shadow-2xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div><div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-1 text-xs text-[#F4D97C]"><ShieldCheck className="h-4 w-4" /> Contrôle humain obligatoire</div><h1 className="text-2xl font-semibold text-white">NOVA — Assistant comptable e-mail</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Tri quotidien des boîtes JS‑Innov.IA et Assurances Dour, archivage Dropbox et préparation d’AI Cost Control. Les publicités certaines sont déplacées vers une corbeille récupérable ; aucun e-mail n’est supprimé définitivement.</p></div>
        <button onClick={runNow} disabled={running} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-3 font-medium text-black disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />{running ? 'Analyse en cours…' : 'Analyser et envoyer le rapport'}</button>
      </div>
    </div>

    {error && <div className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200"><AlertTriangle className="h-5 w-5" />{error}</div>}
    {mailboxFailures.length > 0 && <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100"><div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-5 w-5" />Une boîte e-mail nécessite une intervention</div>{mailboxFailures.map(([key, mailbox]) => <p key={key} className="mt-2 text-xs text-amber-200/80">{key === 'assurances' ? 'Assurances Dour' : key} : {mailbox.error_code === 'authentication_failed' ? `identifiants refusés — renouveler le secret Railway ${mailbox.required_secret}` : 'connexion impossible'}</p>)}</div>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon={Clock3} label="En attente de validation" value={status?.pending_reviews ?? '—'} />
      <Stat icon={Archive} label="Pièces déjà archivées" value={archived} color="text-cyan-300" />
      <Stat icon={MailCheck} label="Rapport quotidien" value={reportLabel} color={status?.last_report?.status === 'failed' ? 'text-red-300' : 'text-emerald-300'} />
      <Stat icon={CheckCircle2} label="Heure planifiée" value={`${status?.report_hour ?? 18} h`} color="text-violet-300" />
    </div>

    <section className="rounded-2xl border border-white/10 bg-[#0d0d18] p-4 sm:p-5">
      <div className="mb-4"><h2 className="font-semibold text-white">Éléments à valider</h2><p className="text-xs text-slate-500">NOVA propose ; vous confirmez le client, le montant et l’imputation comptable.</p></div>
      {loading ? <div className="py-10 text-center text-slate-400">Chargement…</div> : items.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-slate-400">Aucun e-mail incertain en attente.</div> : <div className="space-y-3">{items.map((item) => {
        const draft = drafts[item.id] || {};
        return <article key={item.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#D4AF37]/10 px-2 py-1 text-[11px] text-[#F4D97C]">{item.category}</span>{item.document_id && <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200">Dropbox archivé</span>}</div><button onClick={() => openMessage(item)} className="group mt-2 block max-w-full text-left" title="Voir le contenu de l’e-mail"><h3 className="truncate font-medium text-white underline-offset-4 group-hover:text-[#F4D97C] group-hover:underline">{item.subject}</h3><p className="truncate text-xs text-slate-400">{item.sender}</p></button><p className="mt-1 text-xs text-slate-500">{item.provider || 'Fournisseur à identifier'} · {euro(item.amount_minor)} · confiance {Math.round(Number(item.confidence || 0) * 100)} %</p><button onClick={() => openMessage(item)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:border-[#D4AF37]/40 hover:text-[#F4D97C]"><Eye className="h-3.5 w-3.5" />Voir l’e-mail</button></div>
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-[520px] lg:grid-cols-3"><select value={draft.client_id || ''} onChange={(event) => updateDraft(item.id, { client_id: event.target.value })} className="rounded-lg border border-white/10 bg-[#151522] px-3 py-2 text-sm text-white"><option value="">Choisir le client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nom || client.raison_sociale || client.email || client.id}</option>)}</select><input value={draft.amount_minor || ''} onChange={(event) => updateDraft(item.id, { amount_minor: event.target.value })} placeholder={item.amount_minor ? (item.amount_minor / 100).toFixed(2) : 'Montant EUR'} className="rounded-lg border border-white/10 bg-[#151522] px-3 py-2 text-sm text-white" /><button onClick={() => review(item, 'import_cost')} className="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-medium text-black">Valider dans AI Cost</button><button onClick={() => review(item, 'archive_only')} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200">Archiver seulement</button><button onClick={() => review(item, 'ignore')} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">Ignorer</button></div></div>
        </article>;
      })}</div>}
    </section>
    <MessageModal item={selectedItem} message={messageDetail} loading={messageLoading} error={messageError} onClose={() => { setSelectedItem(null); setMessageDetail(null); setMessageError(''); }} />
  </div>;
}
