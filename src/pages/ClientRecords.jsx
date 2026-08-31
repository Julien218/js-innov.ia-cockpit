import { useQuery } from '@tanstack/react-query';
import { FileText, FolderKanban, Receipt } from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';

const CONFIG = {
  projects: {
    table: 'Projet',
    title: 'Mes projets',
    subtitle: 'Suivi des projets rattachés à votre organisation',
    icon: FolderKanban,
  },
  quotes: {
    table: 'Devis',
    title: 'Mes devis',
    subtitle: 'Devis disponibles dans votre espace client',
    icon: FileText,
  },
  invoices: {
    table: 'Facture',
    title: 'Mes factures',
    subtitle: 'Factures que JS-Innov.IA vous adresse, pour vos différentes structures',
    icon: Receipt,
  },
};

async function loadRows(table) {
  const response = await fetch(`/api/data/${table}?limit=300`, { credentials: 'same-origin' });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.error || 'Données momentanément indisponibles');
  return Array.isArray(data) ? data : [];
}

function money(value) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' }) : '—';
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('fr-BE');
}

function ProjectCard({ row }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-foreground">{row.nom || 'Projet'}</h2>
          {row.description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{row.description}</p>}
        </div>
        {row.statut && <StatusBadge status={row.statut} />}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
        <span>Début : {date(row.date_debut)}</span>
        <span>Échéance : {date(row.date_fin_prevue)}</span>
        <span>Progression : {Number.isFinite(Number(row.progression)) ? `${Number(row.progression)} %` : '—'}</span>
      </div>
    </article>
  );
}

function BillingCard({ row, kind }) {
  const isQuote = kind === 'quotes';
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.numero || (isQuote ? 'Devis' : 'Facture')}</p>
          <h2 className="mt-1 font-semibold text-foreground">{row.objet || (isQuote ? 'Devis JS-Innov.IA' : 'Facture JS-Innov.IA')}</h2>
          {!isQuote && <p className="mt-2 text-xs text-muted-foreground">Émetteur : JS-Innov.IA · Facturé à : {row.client_nom || 'Votre structure'}</p>}
        </div>
        {row.statut && <StatusBadge status={row.statut} />}
      </div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-xs text-muted-foreground">Total TTC</p>
          <p className="text-lg font-bold text-foreground">{money(row.montant_ttc)}</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {!isQuote && <div>Émission : {date(row.date_emission)}</div>}
          {isQuote ? `Validité : ${date(row.date_validite)}` : `Échéance : ${date(row.date_echeance)}`}
        </div>
      </div>
      {!isQuote && <details className="mt-4 border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium">Détail de la facture</summary>
        <div className="mt-3 space-y-3">
          {(row.invoice_lines || []).map((line, index) => <div key={index} className="flex justify-between gap-4">
            <div><p>{line.description || 'Prestation'}</p>{line.periode && <p className="text-xs text-muted-foreground">{line.periode}</p>}<p className="text-xs text-muted-foreground">Prix unitaire HT : {money(line.prix_unitaire_ht ?? line.unit_price_ht)}{line.quantite != null || line.quantity != null ? ` · Quantité : ${line.quantite ?? line.quantity}` : ''}</p></div>
            {line.total_ttc != null && <span className="whitespace-nowrap">{money(line.total_ttc)} TTC</span>}
          </div>)}
          {!row.invoice_lines?.length && <p className="text-muted-foreground">Détail des prestations non renseigné.</p>}
          <p>Total HT : {money(row.montant_ht)} · Total TTC : {money(row.montant_ttc)}</p>
        </div>
      </details>}
    </article>
  );
}

export default function ClientRecords({ kind }) {
  const config = CONFIG[kind] || CONFIG.projects;
  const Icon = config.icon;
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['client-records', config.table],
    queryFn: () => loadRows(config.table),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{config.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{config.subtitle}</p>
        </div>
      </header>

      {isLoading && <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Chargement…</div>}

      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-700">
          <p>{error?.message || 'Impossible de charger les données.'}</p>
          <button type="button" onClick={() => refetch()} className="mt-3 font-semibold underline">Réessayer</button>
        </div>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun élément disponible dans votre espace pour le moment.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {data.map((row) => kind === 'projects'
          ? <ProjectCard key={row.id} row={row} />
          : <BillingCard key={row.id} row={row} kind={kind} />)}
      </div>

      <p className="text-xs text-muted-foreground">
        Besoin d’une précision ou d’une modification ? Utilisez votre assistant client en bas à droite pour transmettre une demande à l’équipe JS-Innov.IA.
      </p>
    </div>
  );
}
