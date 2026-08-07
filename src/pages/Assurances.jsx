import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  FileCheck2,
  MailSearch,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';

const OLIVIER_EMAIL = 'olivier.trevis@pv.be';
const SUPERADMIN_ROLES = new Set(['superadmin', 'super_admin']);
const LEAD_STATUS_OPTIONS = ['nouveau', 'contacte', 'rendez_vous', 'devis', 'contrat_emis', 'perdu'];
const COMMISSION_OPTIONS = ['a_verifier', 'validee', 'payee'];
const TASK_STATUS_OPTIONS = ['a_faire', 'en_cours', 'en_attente', 'terminee', 'ignoree'];
const TASK_ASSIGNEES = ['julien', 'olivier', 'christelle', 'corentin', 'freddy', 'agence'];

const statusLabels = {
  nouveau: 'Nouveau', contacte: 'Contacté', rendez_vous: 'Rendez-vous', devis: 'Devis', contrat_emis: 'Contrat émis', perdu: 'Perdu',
  a_faire: 'À faire', en_cours: 'En cours', en_attente: 'En attente', terminee: 'Terminée', ignoree: 'Ignorée',
};
const commissionLabels = { a_verifier: 'À vérifier', validee: 'Validée', payee: 'Payée' };
const priorityLabels = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' };
const categoryLabels = {
  sinistre: 'Sinistre', paiement: 'Paiement', carte_document: 'Carte / document', nouveau_client_particulier: 'Nouveau client particulier',
  nouveau_client_pro: 'Nouveau client pro', rendez_vous: 'Rendez-vous', contrat: 'Contrat', assistance: 'Assistance', administratif: 'Administratif', autre: 'Autre',
};
const assigneeLabels = { julien: 'Julien', olivier: 'Olivier', christelle: 'Christelle', corentin: 'Corentin', freddy: 'Freddy', agence: 'Agence' };

function canViewInsurance(user) {
  const role = String(user?.role || '').toLowerCase();
  const email = String(user?.email || '').toLowerCase();
  return SUPERADMIN_ROLES.has(role) || email === OLIVIER_EMAIL;
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
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>
      </div>
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fr-BE');
}

export default function Assurances() {
  const { user } = useAuth();
  const allowed = canViewInsurance(user);
  const [tab, setTab] = useState('emailTasks');
  const [leads, setLeads] = useState([]);
  const [reports, setReports] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [emailTasks, setEmailTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingId, setSavingId] = useState('');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const [leadRows, reportRows, deliveryRows, taskRows] = await Promise.all([
        api('/leads?limit=500'),
        api('/reports?limit=100'),
        api('/deliveries?limit=100'),
        api('/email-tasks?limit=500'),
      ]);
      setLeads(Array.isArray(leadRows) ? leadRows : []);
      setReports(Array.isArray(reportRows) ? reportRows : []);
      setDeliveries(Array.isArray(deliveryRows) ? deliveryRows : []);
      setEmailTasks(Array.isArray(taskRows) ? taskRows : []);
    } catch (loadError) {
      setError(loadError.message || 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => {
    const today = new Date().toLocaleDateString('fr-BE');
    return {
      leads: leads.length,
      clients: leads.filter((lead) => lead.is_client).length,
      openTasks: emailTasks.filter((task) => task.action_required && !['terminee', 'ignoree'].includes(task.status)).length,
      completedToday: emailTasks.filter((task) => task.completed_at && new Date(task.completed_at).toLocaleDateString('fr-BE') === today).length,
    };
  }, [leads, emailTasks]);

  const syncEmails = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/email-tasks/sync', { method: 'POST', body: JSON.stringify({ limit: 25 }) });
      setNotice(`Analyse terminée : ${result.created || 0} nouvelle(s) tâche(s), ${result.skipped || 0} e-mail(s) déjà analysé(s).`);
      await load();
    } catch (syncError) {
      setError(syncError.message || 'Analyse des e-mails impossible.');
    } finally {
      setSyncing(false);
    }
  };

  const updateTask = async (task, patch) => {
    setSavingId(task.id);
    setError('');
    try {
      const updated = await api(`/email-tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setEmailTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (saveError) {
      setError(saveError.message || 'Mise à jour impossible.');
    } finally {
      setSavingId('');
    }
  };

  const updateLead = async (lead, patch) => {
    setSavingId(lead.id);
    setError('');
    try {
      const updated = await api(`/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setLeads((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (saveError) {
      setError(saveError.message || 'Mise à jour impossible.');
    } finally {
      setSavingId('');
    }
  };

  if (!allowed) {
    return <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-red-900"><div className="flex items-center gap-3"><AlertTriangle className="h-6 w-6" /><h1 className="text-lg font-bold">Accès non autorisé</h1></div><p className="mt-3 text-sm">Cet espace est réservé à Julien Pagin et Olivier Trevis.</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-primary" /><h1 className="text-2xl font-bold">Assurances-Dour</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Suivi partagé Julien / Olivier. L’agent IA analyse la boîte info@assurances-dour.be et propose les actions à suivre.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Actualiser</Button>
          <Button onClick={syncEmails} disabled={syncing}><Bot className={`mr-2 h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />{syncing ? 'Analyse en cours…' : 'Analyser les e-mails'}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Users} label="Leads" value={metrics.leads} />
        <Metric icon={FileCheck2} label="Clients" value={metrics.clients} />
        <Metric icon={Clock3} label="Tâches ouvertes" value={metrics.openTasks} />
        <Metric icon={CheckCircle2} label="Terminées aujourd’hui" value={metrics.completedToday} />
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {[
          ['emailTasks', `Suivi e-mails (${emailTasks.length})`],
          ['leads', `Leads (${leads.length})`],
          ['reports', `Rapports (${reports.length})`],
          ['deliveries', `Journal d’envoi (${deliveries.length})`],
        ].map(([value, label]) => <Button key={value} size="sm" variant={tab === value ? 'default' : 'outline'} onClick={() => setTab(value)}>{label}</Button>)}
      </div>

      {loading && <EmptyState>Chargement des données Assurances-Dour…</EmptyState>}

      {!loading && tab === 'emailTasks' && (
        emailTasks.length === 0 ? <EmptyState>Aucun e-mail analysé pour le moment. Cliquez sur « Analyser les e-mails ».</EmptyState> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="min-w-[1500px] w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="p-3">Fini</th><th className="p-3">E-mail reçu</th><th className="p-3">Expéditeur</th><th className="p-3">Objet</th><th className="p-3">Action IA</th><th className="p-3">Catégorie</th><th className="p-3">Responsable</th><th className="p-3">Priorité</th><th className="p-3">Statut</th><th className="p-3">Terminé le / par</th><th className="p-3">IA</th></tr>
              </thead>
              <tbody>
                {emailTasks.map((task) => {
                  const done = task.status === 'terminee';
                  return (
                    <tr key={task.id} className={`border-t border-border align-top ${done ? 'bg-emerald-50/40' : ''}`}>
                      <td className="p-3"><input type="checkbox" checked={done} disabled={savingId === task.id || task.status === 'ignoree'} onChange={(event) => updateTask(task, { status: event.target.checked ? 'terminee' : 'a_faire' })} aria-label={`Terminer ${task.task_title || task.email_subject}`} /></td>
                      <td className="p-3 whitespace-nowrap"><p className="font-medium">{formatDate(task.email_date)}</p><p className="text-xs text-muted-foreground">UID {task.email_uid}</p></td>
                      <td className="max-w-[220px] p-3 text-xs">{task.email_from || '—'}</td>
                      <td className="max-w-[260px] p-3"><p className="font-medium">{task.email_subject || '(sans objet)'}</p></td>
                      <td className="max-w-[360px] p-3"><p className="font-semibold">{task.task_title || 'Aucune action'}</p><p className="mt-1 text-xs text-muted-foreground">{task.task_summary || '—'}</p></td>
                      <td className="p-3">{categoryLabels[task.category] || task.category || '—'}</td>
                      <td className="p-3"><select className="rounded-md border border-border bg-white px-2 py-1" value={task.assignee || 'agence'} disabled={savingId === task.id} onChange={(e) => updateTask(task, { assignee: e.target.value })}>{TASK_ASSIGNEES.map((value) => <option key={value} value={value}>{assigneeLabels[value]}</option>)}</select></td>
                      <td className="p-3"><select className="rounded-md border border-border bg-white px-2 py-1" value={task.priority || 'normale'} disabled={savingId === task.id} onChange={(e) => updateTask(task, { priority: e.target.value })}>{Object.keys(priorityLabels).map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></td>
                      <td className="p-3"><select className="rounded-md border border-border bg-white px-2 py-1" value={task.status || 'a_faire'} disabled={savingId === task.id} onChange={(e) => updateTask(task, { status: e.target.value })}>{TASK_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></td>
                      <td className="p-3 text-xs"><p>{formatDate(task.completed_at)}</p><p className="text-muted-foreground">{task.completed_by || '—'}</p></td>
                      <td className="p-3 text-xs"><p>{task.ai_model || '—'}</p><p className="text-muted-foreground">{typeof task.ai_confidence === 'number' ? `${Math.round(task.ai_confidence * 100)} %` : '—'}</p></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && tab === 'leads' && (
        leads.length === 0 ? <EmptyState>Aucun lead assurance enregistré.</EmptyState> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white"><table className="min-w-[1100px] w-full text-sm"><thead className="bg-muted/60 text-left"><tr><th className="p-3">Lead</th><th className="p-3">Contact</th><th className="p-3">Assurance</th><th className="p-3">Statut</th><th className="p-3">Client</th><th className="p-3">Contrat</th><th className="p-3">Commission</th><th className="p-3">Créé le</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id} className="border-t border-border"><td className="p-3 font-semibold">{lead.full_name || lead.company_name || 'Sans nom'}</td><td className="p-3 text-xs">{lead.email || lead.phone || '—'}</td><td className="p-3">{lead.insurance_type || '—'}</td><td className="p-3"><select value={lead.status} disabled={savingId === lead.id} onChange={(e) => updateLead(lead, { status: e.target.value })} className="rounded-md border px-2 py-1">{LEAD_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></td><td className="p-3"><input type="checkbox" checked={Boolean(lead.is_client)} disabled={savingId === lead.id} onChange={(e) => updateLead(lead, { is_client: e.target.checked })} /></td><td className="p-3">{lead.contract_reference || '—'}</td><td className="p-3"><select value={lead.commission_status || 'a_verifier'} disabled={savingId === lead.id} onChange={(e) => updateLead(lead, { commission_status: e.target.value })} className="rounded-md border px-2 py-1">{COMMISSION_OPTIONS.map((value) => <option key={value} value={value}>{commissionLabels[value]}</option>)}</select></td><td className="p-3 whitespace-nowrap">{formatDate(lead.created_at)}</td></tr>)}</tbody></table></div>
        )
      )}

      {!loading && tab === 'reports' && (reports.length === 0 ? <EmptyState>Aucun rapport généré.</EmptyState> : <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-[900px] w-full text-sm"><thead className="bg-muted/60 text-left"><tr><th className="p-3">Type</th><th className="p-3">Période</th><th className="p-3">Statut</th><th className="p-3">Leads</th><th className="p-3">Contrats</th><th className="p-3">Envoyé le</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id} className="border-t"><td className="p-3">{report.report_type === 'monthly' ? 'Mensuel' : 'Hebdomadaire'}</td><td className="p-3">{report.period_start} → {report.period_end}</td><td className="p-3">{report.status}</td><td className="p-3">{report.counts?.total_leads ?? 0}</td><td className="p-3">{report.counts?.contracts_issued ?? 0}</td><td className="p-3">{formatDate(report.sent_at)}</td></tr>)}</tbody></table></div>)}

      {!loading && tab === 'deliveries' && (deliveries.length === 0 ? <EmptyState>Aucun envoi journalisé.</EmptyState> : <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-[1000px] w-full text-sm"><thead className="bg-muted/60 text-left"><tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Destinataires</th><th className="p-3">Objet</th><th className="p-3">Statut</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery.id} className="border-t"><td className="p-3">{formatDate(delivery.created_at)}</td><td className="p-3">{delivery.message_type}</td><td className="p-3 text-xs">{Array.isArray(delivery.to_recipients) ? delivery.to_recipients.join(', ') : '—'}</td><td className="p-3">{delivery.subject}</td><td className="p-3">{delivery.status}</td></tr>)}</tbody></table></div>)}

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900"><div className="flex items-start gap-2"><MailSearch className="mt-0.5 h-4 w-4 flex-none" /><p><strong>Traçabilité :</strong> le tableau conserve la date et l’heure de l’e-mail, l’analyse IA, le responsable, le statut, ainsi que la date et l’utilisateur ayant clôturé la tâche. Le contenu complet des e-mails n’est pas conservé dans ce tableau.</p></div></div>
    </div>
  );
}
