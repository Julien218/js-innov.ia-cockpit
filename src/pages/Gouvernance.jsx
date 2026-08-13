import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '../components/shared/PageHeader';
import StatusBadge from '../components/shared/StatusBadge';
import { Shield, FileText, Users, AlertTriangle, CheckCircle, Clock, Lock } from 'lucide-react';

const API = '/api/governance';

// ─── Tab navigation ─────────────────────────────────────────────
const TABS = [
  { id: 'dashboard', label: 'Tableau de bord', icon: Shield },
  { id: 'audit', label: 'Journal d\'audit', icon: FileText },
  { id: 'processing', label: 'Traitements', icon: Users },
  { id: 'subprocessors', label: 'Sous-traitants', icon: Lock },
  { id: 'consents', label: 'Consentements', icon: CheckCircle },
  { id: 'dsr', label: 'Demandes RGPD', icon: AlertTriangle },
  { id: 'retention', label: 'Conservation', icon: Clock },
];

export default function Gouvernance() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Gouvernance & RGPD"
        subtitle="Data Governance, Privacy by Design, registre des traitements et demandes RGPD"
      />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2 flex-wrap">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'audit' && <AuditTab />}
      {activeTab === 'processing' && <ProcessingTab />}
      {activeTab === 'subprocessors' && <SubprocessorsTab />}
      {activeTab === 'consents' && <ConsentsTab />}
      {activeTab === 'dsr' && <DSRTab />}
      {activeTab === 'retention' && <RetentionTab />}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────
function DashboardTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['governance-dashboard'],
    queryFn: () => fetch(`${API}/dashboard`, { credentials: 'include' }).then(r => r.json()),
  });

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>;
  if (!data?.success) return <div className="text-destructive">Erreur de chargement</div>;

  const d = data.data;

  const stats = [
    { label: 'Entrées d\'audit', value: d.audit_entries, icon: FileText },
    { label: 'Demandes RGPD en attente', value: d.dsr.received + d.dsr.processing, icon: AlertTriangle, alert: (d.dsr.received + d.dsr.processing) > 0 },
    { label: 'Sous-traitants (DPA signés)', value: `${d.subprocessors.dpa_signed}/${d.subprocessors.total}`, icon: Lock },
    { label: 'Traitements validés', value: d.processing_activities.validated, icon: CheckCircle },
    { label: 'Politiques en attente', value: d.retention_policies.pending_validation, icon: Clock },
    { label: 'Consentements actifs', value: d.consents.active, icon: CheckCircle },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stats.map((stat, i) => {
        const Icon = stat.icon;
        return (
          <div key={i} className="rounded-lg border bg-card p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
              <Icon className={`w-5 h-5 ${stat.alert ? 'text-destructive' : 'text-muted-foreground'}`} />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        );
      })}
      <div className="col-span-full rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <p className="text-sm text-amber-600 dark:text-amber-400">
          ⚠️ Les durées de conservation et bases légales sont en statut <strong>pending</strong> jusqu'à validation juridique.
        </p>
      </div>
    </div>
  );
}

// ─── Audit Log ──────────────────────────────────────────────────
function AuditTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['governance-audit'],
    queryFn: () => fetch(`${API}/audit?limit=200`, { credentials: 'include' }).then(r => r.json()),
  });

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>;
  const entries = data?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{entries.length} entrées (1000 max)</p>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Action</th>
              <th className="text-left p-3">Acteur</th>
              <th className="text-left p-3">Entité</th>
              <th className="text-left p-3">Description</th>
              <th className="text-left p-3">Sévérité</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-t border-border hover:bg-accent/30">
                <td className="p-3 text-muted-foreground">{new Date(e.created_at).toLocaleString('fr-BE')}</td>
                <td className="p-3 font-mono text-xs">{e.action}</td>
                <td className="p-3">{e.actor_email || e.actor_role || 'system'}</td>
                <td className="p-3 text-xs">{e.entity_type || '—'}</td>
                <td className="p-3">{e.description || '—'}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    e.severity === 'critical' ? 'bg-destructive/10 text-destructive' :
                    e.severity === 'error' ? 'bg-red-500/10 text-red-500' :
                    e.severity === 'warning' ? 'bg-amber-500/10 text-amber-500' :
                    'bg-muted text-muted-foreground'
                  }`}>{e.severity}</span>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan="6" className="p-6 text-center text-muted-foreground">Aucune entrée d'audit pour le moment</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Processing Activities ──────────────────────────────────────
function ProcessingTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['governance-pa'],
    queryFn: () => fetch(`${API}/processing-activities`, { credentials: 'include' }).then(r => r.json()),
  });

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>;
  const items = data?.data || [];

  return (
    <div className="space-y-3">
      {items.map((pa, i) => (
        <div key={i} className="rounded-lg border bg-card p-5">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-foreground">{pa.name}</h3>
            <StatusBadge status={pa.legal_validation_status} />
          </div>
          <p className="text-sm text-muted-foreground mb-3">{pa.purpose}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {pa.legal_basis && <div><span className="text-muted-foreground">Base légale:</span> <span className="font-medium">{pa.legal_basis}</span></div>}
            {pa.retention_period && <div><span className="text-muted-foreground">Conservation:</span> <span className="font-medium">{pa.retention_period}</span></div>}
            {pa.recipients && <div><span className="text-muted-foreground">Destinataires:</span> <span className="font-medium">{pa.recipients}</span></div>}
            {pa.transfers_outside_eee && <div className="text-amber-500">⚠️ Transfert hors EEE</div>}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-muted-foreground text-center py-8">Aucun traitement enregistré</p>}
    </div>
  );
}

// ─── Subprocessors ───────────────────────────────────────────────
function SubprocessorsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['governance-sr'],
    queryFn: () => fetch(`${API}/subprocessors`, { credentials: 'include' }).then(r => r.json()),
  });

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>;
  const items = data?.data || [];

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="text-left p-3">Fournisseur</th>
            <th className="text-left p-3">Finalité</th>
            <th className="text-left p-3">Localisation</th>
            <th className="text-left p-3">DPA</th>
            <th className="text-left p-3">Transfert</th>
            <th className="text-left p-3">Statut</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s, i) => (
            <tr key={i} className="border-t border-border hover:bg-accent/30">
              <td className="p-3 font-medium">{s.provider_name}</td>
              <td className="p-3 text-muted-foreground">{s.service_purpose}</td>
              <td className="p-3 text-xs">{s.processing_location}</td>
              <td className="p-3">{s.dpa_signed ? '✅ Signé' : '⏳ En attente'}</td>
              <td className="p-3 text-xs">{s.transfer_mechanism}</td>
              <td className="p-3"><StatusBadge status={s.validation_status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Consents ───────────────────────────────────────────────────
function ConsentsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['governance-consents'],
    queryFn: () => fetch(`${API}/consents`, { credentials: 'include' }).then(r => r.json()),
  });

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>;
  const items = data?.data || [];

  return (
    <div className="space-y-3">
      {items.map((c, i) => (
        <div key={i} className="rounded-lg border bg-card p-4 flex justify-between items-center">
          <div>
            <p className="font-medium">{c.person_email}</p>
            <p className="text-sm text-muted-foreground">{c.purpose} — {new Date(c.given_at).toLocaleDateString('fr-BE')}</p>
          </div>
          <span className={`px-3 py-1 rounded-lg text-xs font-medium ${
            c.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
          }`}>{c.status === 'active' ? 'Actif' : 'Retiré'}</span>
        </div>
      ))}
      {items.length === 0 && <p className="text-muted-foreground text-center py-8">Aucun consentement enregistré</p>}
    </div>
  );
}

// ─── Data Subject Requests ──────────────────────────────────────
function DSRTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['governance-dsr'],
    queryFn: () => fetch(`${API}/dsr`, { credentials: 'include' }).then(r => r.json()),
  });

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>;
  const items = data?.data || [];

  return (
    <div className="space-y-3">
      {items.map((d, i) => (
        <div key={i} className="rounded-lg border bg-card p-5">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="font-semibold capitalize">{d.request_type} — {d.requester_email}</h3>
              <p className="text-xs text-muted-foreground">Reçue: {new Date(d.received_at).toLocaleDateString('fr-BE')} — Échéance: {new Date(d.due_date).toLocaleDateString('fr-BE')}</p>
            </div>
            <StatusBadge status={d.status} />
          </div>
          {d.description && <p className="text-sm text-muted-foreground mt-2">{d.description}</p>}
          {d.resolution_summary && <p className="text-sm mt-2 p-2 rounded bg-muted/30">✅ {d.resolution_summary}</p>}
        </div>
      ))}
      {items.length === 0 && <p className="text-muted-foreground text-center py-8">Aucune demande RGPD pour le moment</p>}
    </div>
  );
}

// ─── Retention Policies ─────────────────────────────────────────
function RetentionTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['governance-rp'],
    queryFn: () => fetch(`${API}/retention-policies`, { credentials: 'include' }).then(r => r.json()),
  });

  if (isLoading) return <div className="text-muted-foreground">Chargement...</div>;
  const items = data?.data || [];

  return (
    <div className="space-y-3">
      {items.map((r, i) => (
        <div key={i} className="rounded-lg border bg-card p-5">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold">{r.category_label || r.category}</h3>
            <StatusBadge status={r.validation_status} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-muted-foreground">Durée:</span> {r.retention_description || 'Illimité'}</div>
            <div><span className="text-muted-foreground">Action fin:</span> {r.action_on_expiry}</div>
            {r.justification && <div><span className="text-muted-foreground">Justification:</span> {r.justification}</div>}
            {r.legal_reference && <div><span className="text-muted-foreground">Référence:</span> {r.legal_reference}</div>}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-muted-foreground text-center py-8">Aucune politique de conservation</p>}
    </div>
  );
}
