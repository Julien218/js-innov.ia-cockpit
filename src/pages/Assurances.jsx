import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileCheck2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';

const OLIVIER_EMAIL = 'olivier.trevis@pv.be';
const STATUS_OPTIONS = ['nouveau', 'contacte', 'rendez_vous', 'devis', 'contrat_emis', 'perdu'];
const COMMISSION_OPTIONS = ['a_verifier', 'validee', 'payee'];

const sourceLabels = {
  SITE: 'Site',
  CHATBOT_IA: 'Chatbot IA',
  AGENT_IA_TELEPHONIQUE: 'Agent IA téléphonique',
};

const statusLabels = {
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  rendez_vous: 'Rendez-vous',
  devis: 'Devis',
  contrat_emis: 'Contrat émis',
  perdu: 'Perdu',
};

const commissionLabels = {
  a_verifier: 'À vérifier',
  validee: 'Validée',
  payee: 'Payée',
};

function canViewInsurance(user) {
  return user?.role === 'superadmin'
    || String(user?.email || '').toLowerCase() === OLIVIER_EMAIL;
}

async function api(path, options = {}) {
  const response = await fetch(`/api/insurance${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
  return data;
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export default function Assurances() {
  const { user } = useAuth();
  const allowed = canViewInsurance(user);
  const [tab, setTab] = useState('leads');
  const [leads, setLeads] = useState([]);
  const [reports, setReports] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const [leadRows, reportRows, deliveryRows] = await Promise.all([
        api('/leads?limit=500'),
        api('/reports?limit=100'),
        api('/deliveries?limit=100'),
      ]);
      setLeads(Array.isArray(leadRows) ? leadRows : []);
      setReports(Array.isArray(reportRows) ? reportRows : []);
      setDeliveries(Array.isArray(deliveryRows) ? deliveryRows : []);
    } catch (loadError) {
      setError(loadError.message || 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => ({
    leads: leads.length,
    clients: leads.filter((lead) => lead.is_client).length,
    contracts: leads.filter((lead) => lead.status === 'contrat_emis' || lead.contract_reference).length,
    commissions: leads.filter((lead) => lead.commission_status !== 'payee').length,
  }), [leads]);

  const updateLead = async (lead, patch) => {
    setSavingId(lead.id);
    setError('');
    try {
      const updated = await api(`/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setLeads((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (saveError) {
      setError(saveError.message || 'Mise à jour impossible.');
    } finally {
      setSavingId('');
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <div className="flex items-center gap-3"><AlertTriangle className="h-6 w-6" /><h1 className="text-lg font-bold">Accès non autorisé</h1></div>
        <p className="mt-3 text-sm">Cet onglet est réservé à Julien Pagin, super administrateur, et à Olivier Trevis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-primary" /><h1 className="text-2xl font-bold">Assurances</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Leads et contrats émis sous le numéro de producteur <strong>0969</strong>.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Actualiser
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Users} label="Leads" value={metrics.leads} />
        <Metric icon={Users} label="Clients" value={metrics.clients} />
        <Metric icon={FileCheck2} label="Contrats émis" value={metrics.contracts} />
        <Metric icon={AlertTriangle} label="Commissions ouvertes" value={metrics.commissions} />
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {[
          ['leads', `Leads (${leads.length})`],
          ['reports', `Rapports (${reports.length})`],
          ['deliveries', `Journal d’envoi (${deliveries.length})`],
        ].map(([value, label]) => (
          <Button key={value} size="sm" variant={tab === value ? 'default' : 'outline'} onClick={() => setTab(value)}>{label}</Button>
        ))}
      </div>

      {loading ? <EmptyState>Chargement des données assurances…</EmptyState> : null}

      {!loading && tab === 'leads' && (
        leads.length === 0 ? <EmptyState>Aucun lead assurance enregistré.</EmptyState> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="min-w-[1180px] w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">Lead</th><th className="p-3">Contact</th><th className="p-3">Source</th>
                  <th className="p-3">Assurance</th><th className="p-3">Destinataire</th><th className="p-3">Statut</th>
                  <th className="p-3">Client</th><th className="p-3">Contrat</th><th className="p-3">Commission</th><th className="p-3">Créé le</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-border align-top">
                    <td className="p-3"><p className="font-semibold">{lead.full_name || lead.company_name || 'Sans nom'}</p><p className="text-xs text-muted-foreground">{lead.external_id}</p></td>
                    <td className="p-3"><p>{lead.email || '—'}</p><p>{lead.phone || '—'}</p></td>
                    <td className="p-3">{sourceLabels[lead.source] || lead.source}</td>
                    <td className="p-3">{lead.insurance_type || 'Non précisé'}</td>
                    <td className="max-w-[220px] p-3 text-xs">{lead.internal_recipient || '—'}</td>
                    <td className="p-3">
                      <select className="rounded-md border border-border bg-white px-2 py-1" value={lead.status} disabled={savingId === lead.id} onChange={(event) => updateLead(lead, { status: event.target.value })}>
                        {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
                      </select>
                    </td>
                    <td className="p-3">
                      <input type="checkbox" checked={Boolean(lead.is_client)} disabled={savingId === lead.id} onChange={(event) => updateLead(lead, { is_client: event.target.checked })} aria-label={`Client ${lead.full_name || lead.external_id}`} />
                    </td>
                    <td className="p-3">
                      <input className="w-36 rounded-md border border-border px-2 py-1" defaultValue={lead.contract_reference || ''} placeholder="Référence" onBlur={(event) => { if (event.target.value !== (lead.contract_reference || '')) updateLead(lead, { contract_reference: event.target.value }); }} />
                    </td>
                    <td className="p-3">
                      <select className="rounded-md border border-border bg-white px-2 py-1" value={lead.commission_status} disabled={savingId === lead.id} onChange={(event) => updateLead(lead, { commission_status: event.target.value })}>
                        {COMMISSION_OPTIONS.map((value) => <option key={value} value={value}>{commissionLabels[value]}</option>)}
                      </select>
                    </td>
                    <td className="p-3 whitespace-nowrap">{lead.created_at ? new Date(lead.created_at).toLocaleString('fr-BE') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && tab === 'reports' && (
        reports.length === 0 ? <EmptyState>Aucun rapport généré.</EmptyState> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="min-w-[850px] w-full text-sm">
              <thead className="bg-muted/60 text-left"><tr><th className="p-3">Type</th><th className="p-3">Période</th><th className="p-3">Statut</th><th className="p-3">Leads</th><th className="p-3">Contrats</th><th className="p-3">Envoyé le</th></tr></thead>
              <tbody>{reports.map((report) => <tr key={report.id} className="border-t border-border"><td className="p-3">{report.report_type === 'monthly' ? 'Mensuel' : 'Hebdomadaire'}</td><td className="p-3">{report.period_start} → {report.period_end}</td><td className="p-3">{report.status}</td><td className="p-3">{report.counts?.total_leads ?? 0}</td><td className="p-3">{report.counts?.contracts_issued ?? 0}</td><td className="p-3">{report.sent_at ? new Date(report.sent_at).toLocaleString('fr-BE') : '—'}</td></tr>)}</tbody>
            </table>
          </div>
        )
      )}

      {!loading && tab === 'deliveries' && (
        deliveries.length === 0 ? <EmptyState>Aucun envoi journalisé.</EmptyState> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-muted/60 text-left"><tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Destinataires</th><th className="p-3">Objet</th><th className="p-3">Statut</th><th className="p-3">Tentatives</th></tr></thead>
              <tbody>{deliveries.map((delivery) => <tr key={delivery.id} className="border-t border-border"><td className="p-3 whitespace-nowrap">{new Date(delivery.created_at).toLocaleString('fr-BE')}</td><td className="p-3">{delivery.message_type}</td><td className="p-3 text-xs">{(delivery.to_recipients || []).join(', ')}</td><td className="max-w-md p-3">{delivery.subject}</td><td className="p-3">{delivery.status}</td><td className="p-3">{delivery.attempts}</td></tr>)}</tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
