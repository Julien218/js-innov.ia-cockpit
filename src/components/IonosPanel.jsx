import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { RefreshCw, Server, ShieldCheck } from 'lucide-react';

function rows(value) {
  if (Array.isArray(value)) {
    if (value.length === 1 && (Array.isArray(value[0]) || (value[0] && typeof value[0] === 'object' && !value[0].id))) return rows(value[0]);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of ['items', 'domains', 'zones', 'records', 'servers', 'contracts', 'data', 'result']) {
      if (value[key] !== undefined) return rows(value[key]);
    }
    return [value];
  }
  return value ? [value] : [];
}
const tabs = [
  ['Domaines', 'domains_list_domains'], ['DNS', 'dns_get_zones'],
  ['VPS', 'corevps_list_contracts'], ['Serveurs dédiés', 'dedicatedserver_list_contracts'],
  ['Public Cloud', 'cloud_read'],
];
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50';

export default function IonosPanel() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [request, setRequest] = useState(null);
  const owner = user?.role === 'superadmin';
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    fetch('/api/ionos/status', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Connexion indisponible'); setStatus(data); })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [owner]);
  if (!owner) return null;
  async function load(tool, args = {}) {
    setBusy(true); setError(''); setResult(null); setRequest({ tool, args });
    try {
      const response = await fetch('/api/ionos/read', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, arguments: args }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Consultation IONOS impossible');
      setResult(data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  function open(item) {
    if (!item?.id) return;
    if (request.tool === 'dns_get_zones') return load('dns_get_zone', { zone_id: item.id });
    if (request.tool.endsWith('_list_contracts')) return load(request.tool.replace('_list_contracts', '_list_servers'), { contract_id: String(item.id) });
    if (request.tool === 'cloud_read' && !request.args.datacenter_id) return load('cloud_read', { datacenter_id: item.id, offset: 0, limit: 100 });
    if (request.tool === 'cloud_read' && !request.args.server_id) return load('cloud_read', { datacenter_id: request.args.datacenter_id, server_id: item.id });
  }
  const entries = result ? rows(result.data) : [];
  const canOpen = request && (request.tool === 'dns_get_zones' || request.tool.endsWith('_list_contracts') || (request.tool === 'cloud_read' && !request.args.server_id));
  const paginated = request && (request.tool === 'domains_list_domains' || (request.tool === 'cloud_read' && !request.args.server_id));
  return <section className="rounded-2xl border border-border bg-card p-4 space-y-4" aria-label="Connecteur IONOS">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h2 className="font-semibold flex items-center gap-2"><Server className="w-5 h-5" /> IONOS · NOVA ELYNEA</h2>
        <p className="text-sm text-muted-foreground mt-1">Domaines, DNS et serveurs de votre compte IONOS.</p></div>
      <span className="text-xs text-emerald-600 flex items-center gap-1"><ShieldCheck className="w-4 h-4" /> Consultation uniquement</span>
    </div>
    {status && <p className="text-sm text-muted-foreground">{status.hosting_configured
      ? 'Identifiant Hosting configuré. Une consultation vérifie la connexion.'
      : 'Connecteur installé. Ajoutez IONOS_PAT dans les variables Railway de cockpit-v3 pour connecter votre compte.'}
      {' '}{status.cloud_configured ? 'Public Cloud configuré.' : 'Public Cloud : connexion facultative séparée.'}</p>}
    <div className="flex flex-wrap gap-2">{tabs.map(([label, tool]) => <button key={tool} className={button}
      disabled={busy} onClick={() => load(tool, tool === 'domains_list_domains' ? { offset: 0, limit: 100 } : {})}>{label}</button>)}
      {request && <button className={button} disabled={busy} onClick={() => load(request.tool, request.args)} aria-label="Actualiser IONOS"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /></button>}
    </div>
    {busy && <p role="status" className="text-sm">Consultation IONOS en cours…</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {result && <>
      <p className="text-xs text-muted-foreground">Vérifié le {new Date(result.checked_at).toLocaleString('fr-BE')} · {entries.length} résultat(s) sur cette page</p>
      {!entries.length ? <p className="text-sm">Aucune ressource retournée.</p> : <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left border-b border-border"><th className="p-2">Ressource</th><th className="p-2">État / type</th><th className="p-2">Valeur / ressources</th><th className="p-2"><span className="sr-only">Détails</span></th></tr></thead>
        <tbody>{entries.map((item, index) => {
          const value = item && typeof item === 'object' ? item : { name: String(item) };
          const props = value.properties || value;
          const resources = [props.cores != null ? `${props.cores} CPU` : '', props.ram != null ? `${props.ram} Mo RAM` : '', props.vmState || ''].filter(Boolean).join(' · ');
          return <tr key={`${value.id || index}-${index}`} className="border-b border-border/50 align-top">
            <td className="p-2 break-all">{value.name || value.zoneName || props.name || value.contract_name || value.id || 'Ressource'}{value.id && <div className="text-xs text-muted-foreground">{value.id}</div>}</td>
            <td className="p-2">{String(value.status?.state || value.status || value.metadata?.state || value.provisioningStatus || value.type || '—')}</td>
            <td className="p-2 break-all">{value.content != null ? String(value.content) : resources || '—'}{value.ttl != null && <div className="text-xs text-muted-foreground">TTL : {value.ttl} s</div>}</td>
            <td className="p-2">{canOpen && value.id && <button className={button} disabled={busy} onClick={() => open(value)}>Consulter</button>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
      {paginated && <div className="flex gap-2"><button className={button} disabled={busy || !(request.args.offset > 0)} onClick={() => load(request.tool, { ...request.args, offset: Math.max(0, (request.args.offset || 0) - 100), limit: 100 })}>Page précédente</button>
        <button className={button} disabled={busy || entries.length < 100} onClick={() => load(request.tool, { ...request.args, offset: (request.args.offset || 0) + 100, limit: 100 })}>Page suivante</button></div>}
    </>}
    <p className="text-xs text-muted-foreground">Dans NOVA : « Liste mes domaines IONOS ». Pour les VPS et serveurs dédiés, sélectionner d’abord le contrat.</p>
  </section>;
}
