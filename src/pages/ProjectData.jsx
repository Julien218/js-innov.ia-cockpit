import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, Database, Download, Filter, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import RegistrationRows from '@/components/shared/RegistrationRows';

const STATUS = {
  pending: { label: 'En attente', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'Retenu', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rejected: { label: 'Écarté', className: 'bg-rose-100 text-rose-800 border-rose-200' },
};

async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Une erreur est survenue.');
  return data;
}

function Metric({ icon: Icon, label, value, tone = 'text-primary bg-primary/10' }) {
  return <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><div className={`mb-3 inline-flex rounded-xl p-2 ${tone}`}><Icon className="h-4 w-4" /></div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>;
}

function formatDate(value) {
  if (!value) return '—';
  if (!Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function ProjectData() {
  const [collections, setCollections] = useState([]);
  const [selectedKey, setSelectedKey] = useState(() => new URLSearchParams(window.location.search).get('collection') || '');
  const [records, setRecords] = useState([]);
  const selectedCollection = collections.find(collection => collection.key === selectedKey);
  const isRegistration = selectedCollection?.kind === 'registrations';
  const requestId = useRef(0);
  const [lastReadAt, setLastReadAt] = useState(null);
  const [backup, setBackup] = useState({ configured: false });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadCollections = async () => {
    const data = await api('/api/project-data/collections');
    const rows = Array.isArray(data.collections) ? data.collections : [];
    setCollections(rows);
    setBackup(data.backup || { configured: false });
    setSelectedKey((current) => rows.some(row => row.key === current) ? current : rows[0]?.key || '');
  };

  const loadRecords = async (key = selectedKey) => {
    const currentRequest = ++requestId.current;
    if (!key) { setRecords([]); setLoading(false); return; }
    setLoading(true); setError(''); setRecords([]); setLastReadAt(null);
    try {
      const data = await api(`/api/project-data/${encodeURIComponent(key)}/records`);
      if (currentRequest !== requestId.current) return;
      setRecords(Array.isArray(data.records) ? data.records : []);
      setLastReadAt(new Date().toISOString());
    } catch (loadError) {
      if (currentRequest === requestId.current) setError(loadError.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadCollections().catch((loadError) => { setError(loadError.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!collections.some(row => row.key === selectedKey)) return;
    loadRecords(selectedKey);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') loadRecords(selectedKey); }, 60000);
    return () => { clearInterval(timer); requestId.current += 1; };
  }, [selectedKey, collections]);

  const counts = useMemo(() => records.reduce((result, row) => {
    result.total += 1;
    if (isRegistration && ['finalist', 'winner'].includes(row.status)) result.approved += 1;
    else if (result[row.status] !== undefined) result[row.status] += 1;
    return result;
  }, { total: 0, pending: 0, approved: 0, rejected: 0 }), [records, isRegistration]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    return records.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (!query) return true;
      return [row.suggested_name, row.reason, row.display_name, row.first_name, row.last_name, row.email, row.phone, row.city, row.category, row.year].some((value) => String(value || '').toLocaleLowerCase('fr').includes(query));
    });
  }, [records, search, status]);

  const updateStatus = async (record, nextStatus) => {
    setSavingId(record.id); setMessage(''); setError('');
    try {
      await api(`/api/project-data/${encodeURIComponent(selectedKey)}/records/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      setRecords((current) => current.map((row) => row.id === record.id ? { ...row, status: nextStatus } : row));
      setMessage('Statut mis à jour.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingId('');
    }
  };

  const saveDropbox = async () => {
    setBackingUp(true); setMessage(''); setError('');
    try {
      const data = await api(`/api/project-data/${encodeURIComponent(selectedKey)}/backup`, { method: 'POST', body: '{}' });
      setMessage(`Sauvegarde Dropbox créée (${data.rows || 0} réponse(s)).`);
      setBackup((current) => ({ ...current, lastRunAt: new Date().toISOString(), lastError: null }));
    } catch (backupError) {
      setError(backupError.message);
    } finally {
      setBackingUp(false);
    }
  };

  const actions = <div className="flex flex-wrap gap-2">
    <Button variant="outline" size="sm" onClick={() => loadRecords()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} /> Actualiser</Button>
    {selectedKey && !loading && !error && <Button variant="outline" size="sm" asChild><a href={`/api/project-data/${encodeURIComponent(selectedKey)}/export.csv`}><Download /> Export CSV</a></Button>}
    {selectedCollection?.canManage && <Button size="sm" onClick={saveDropbox} disabled={backingUp || !selectedCollection.dropboxBackupConfigured}><Archive /> {backingUp ? 'Sauvegarde…' : 'Sauvegarder Dropbox'}</Button>}
  </div>;

  return <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto">
    <PageHeader title="Données projets" subtitle="Vos informations récoltées, organisées comme dans Airtable" actions={actions} />

    {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

    {collections.length === 0 && !loading ? <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center"><Database className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><h2 className="font-semibold">Aucun tableau partagé</h2><p className="mt-1 text-sm text-muted-foreground">Aucune collecte de données n’est encore rattachée à votre compte.</p></div> : <>
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client · Projet</div><div className="mt-1 font-semibold">{selectedCollection?.client || collections[0]?.client} <span className="text-muted-foreground">→</span> {selectedCollection?.project || collections[0]?.project}</div></div>
        <select aria-label="Projet et collecte" value={selectedKey} onChange={(event) => { setSelectedKey(event.target.value); setRecords([]); setStatus('all'); setLoading(true); setMessage(''); }} className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
          {collections.map((collection) => <option key={collection.key} value={collection.key}>{collection.client} — {collection.project} — {collection.label}</option>)}
        </select>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Database} label={isRegistration ? 'Inscrits / dossiers' : 'Réponses'} value={error || loading ? '—' : counts.total} />
        <Metric icon={Filter} label="En attente" value={error || loading ? '—' : counts.pending} tone="text-amber-700 bg-amber-100" />
        <Metric icon={CheckCircle2} label={isRegistration ? 'Validées / finalistes' : 'Retenues'} value={error || loading ? '—' : counts.approved} tone="text-emerald-700 bg-emerald-100" />
        <Metric icon={XCircle} label={isRegistration ? 'Refusées' : 'Écartées'} value={error || loading ? '—' : counts.rejected} tone="text-rose-700 bg-rose-100" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold">{selectedCollection?.label || 'Réponses collectées'}</h2><p className="text-xs text-muted-foreground">{filtered.length} ligne(s) affichée(s)</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher une réponse…" className="pl-9 sm:w-64" /></div>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">Tous les statuts</option><option value="pending">En attente</option><option value="approved">{isRegistration ? 'Validées' : 'Retenus'}</option><option value="rejected">{isRegistration ? 'Refusées' : 'Écartés'}</option>{isRegistration && <><option value="finalist">Finalistes</option><option value="winner">Lauréats</option></>}</select>
          </div>
        </div>

        <div className="overflow-x-auto">
          {isRegistration ? <RegistrationRows records={filtered} loading={loading} error={error} formatDate={formatDate} /> :
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="p-3">Prénom proposé</th><th className="p-3">Pourquoi ce prénom ?</th><th className="p-3">Participant</th><th className="p-3">Date</th><th className="p-3">Statut</th></tr></thead>
            <tbody>{loading ? <tr><td colSpan="5" className="p-10 text-center text-muted-foreground">Chargement des réponses…</td></tr> : filtered.length === 0 ? <tr><td colSpan="5" className="p-10 text-center text-muted-foreground">Aucune réponse ne correspond à ces filtres.</td></tr> : filtered.map((row) => {
              const badge = STATUS[row.status] || STATUS.pending;
              return <tr key={row.id} className="border-t border-border align-top hover:bg-muted/20"><td className="p-3 font-semibold">{row.suggested_name}</td><td className="max-w-xl whitespace-pre-wrap p-3 text-muted-foreground">{row.reason || '—'}</td><td className="p-3">{row.display_name || 'Anonyme'}</td><td className="whitespace-nowrap p-3 text-xs text-muted-foreground">{formatDate(row.created_at)}</td><td className="p-3">{selectedCollection?.canManage ? <select value={row.status} disabled={savingId === row.id} onChange={(event) => updateStatus(row, event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs"><option value="pending">En attente</option><option value="approved">Retenu</option><option value="rejected">Écarté</option></select> : <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.className}`}>{badge.label}</span>}</td></tr>;
            })}</tbody>
          </table>}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900"><ShieldCheck className="mt-0.5 h-4 w-4 flex-none" /><div><strong>Données protégées :</strong> seules les personnes rattachées à ce projet voient ces réponses. Les adresses IP techniques ne sont jamais affichées. {isRegistration ? 'Lecture directe de la base Miss et Mister Dour, édition 2026. Actualisation chaque minute lorsque cette page est visible. La validation reste sur le site; aucune sauvegarde Dropbox automatique de ces coordonnées.' : backup.configured ? `Une sauvegarde CSV Dropbox est active${backup.lastRunAt ? ` (dernière : ${formatDate(backup.lastRunAt)})` : ''}.` : 'La sauvegarde Dropbox sera activée dès que les trois identifiants Dropbox seront présents sur Railway.'}{lastReadAt && <div className="mt-1">Dernière lecture réussie : {formatDate(lastReadAt)}</div>}</div></div>
    </>}
  </div>;
}
