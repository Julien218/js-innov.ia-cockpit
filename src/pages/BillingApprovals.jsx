import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { CheckCircle2, FileCheck2, RefreshCw, Send, XCircle } from 'lucide-react';

function eurMinor(value) {
  return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(Number(value || 0) / 100);
}

async function fetchJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

export default function BillingApprovals() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState('');

  const draftsQuery = useQuery({
    queryKey: ['billing-approval-drafts'],
    queryFn: () => fetchJson('/api/billing-approvals/drafts'),
    refetchInterval: 60000,
  });

  const approve = useMutation({
    mutationFn: (id) => fetchJson(`/api/billing-approvals/${id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }),
    onSuccess: () => { setNotice('Facture validée. Elle peut maintenant être envoyée.'); qc.invalidateQueries({ queryKey: ['billing-approval-drafts'] }); },
    onError: (error) => setNotice(error.message),
  });

  const reject = useMutation({
    mutationFn: (id) => fetchJson(`/api/billing-approvals/${id}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }),
    onSuccess: () => { setNotice('Facture refusée. Aucun envoi n’est possible.'); qc.invalidateQueries({ queryKey: ['billing-approval-drafts'] }); },
    onError: (error) => setNotice(error.message),
  });

  const send = useMutation({
    mutationFn: (id) => fetchJson(`/api/cost-centers/invoices/${id}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }),
    onSuccess: () => { setNotice('Facture envoyée après validation.'); qc.invalidateQueries({ queryKey: ['billing-approval-drafts'] }); },
    onError: (error) => setNotice(error.message),
  });

  const items = draftsQuery.data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><FileCheck2 className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold">Factures à valider</h1>
            <p className="text-sm text-muted-foreground">Le 1er du mois, les brouillons sont préparés automatiquement. Aucun envoi sans ton approbation.</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => draftsQuery.refetch()}><RefreshCw className={`w-4 h-4 mr-2 ${draftsQuery.isFetching ? 'animate-spin' : ''}`} />Actualiser</Button>
      </div>

      {notice && <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">{notice}</div>}

      <div className="space-y-3">
        {items.map((invoice) => {
          const status = invoice.approval_status || 'pending';
          const center = invoice.cost_center || {};
          return (
            <div key={invoice.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{invoice.invoice_number}</h2>
                    <span className={`text-[11px] rounded-full px-2 py-1 ${status === 'approved' ? 'bg-emerald-500/10 text-emerald-700' : status === 'rejected' ? 'bg-red-500/10 text-red-700' : 'bg-amber-500/10 text-amber-700'}`}>
                      {status === 'approved' ? 'Validée' : status === 'rejected' ? 'Refusée' : 'À valider'}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{center.client_name || center.product_code || 'Client'} · période {String(invoice.period_month).padStart(2, '0')}/{invoice.period_year}</p>
                  {status === 'approved' && invoice.approved_by && <p className="text-xs text-muted-foreground mt-1">Validée par {invoice.approved_by}{invoice.approved_at ? ` · ${new Date(invoice.approved_at).toLocaleString('fr-BE')}` : ''}</p>}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="sm:text-right mr-2"><p className="text-xs text-muted-foreground">Total TTC</p><p className="text-xl font-bold">{eurMinor(invoice.total_minor)}</p></div>
                  {status === 'pending' && <>
                    <Button variant="outline" className="text-red-600" onClick={() => reject.mutate(invoice.id)} disabled={reject.isPending}><XCircle className="w-4 h-4 mr-2" />Refuser</Button>
                    <Button onClick={() => approve.mutate(invoice.id)} disabled={approve.isPending}><CheckCircle2 className="w-4 h-4 mr-2" />Valider</Button>
                  </>}
                  {status === 'approved' && <Button onClick={() => send.mutate(invoice.id)} disabled={send.isPending}><Send className="w-4 h-4 mr-2" />Envoyer</Button>}
                </div>
              </div>
            </div>
          );
        })}

        {!draftsQuery.isLoading && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Aucun brouillon de facture à traiter.</div>
        )}
      </div>
    </div>
  );
}