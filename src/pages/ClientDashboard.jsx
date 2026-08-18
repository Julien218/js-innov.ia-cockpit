import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, FolderKanban, MessageSquare, Receipt, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

async function loadTable(table) {
  const response = await fetch(`/api/data/${table}?limit=200`, { credentials: 'same-origin' });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.error || `Impossible de charger ${table}`);
  return Array.isArray(data) ? data : [];
}

function Card({ icon: Icon, label, value, detail, href }) {
  const content = (
    <div className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-2xl font-bold text-foreground">{value}</span>
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">{label}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
  return href ? <Link to={href}>{content}</Link> : content;
}

export default function ClientDashboard() {
  const { user } = useAuth();
  const projects = useQuery({ queryKey: ['client', 'Projet'], queryFn: () => loadTable('Projet') });
  const quotes = useQuery({ queryKey: ['client', 'Devis'], queryFn: () => loadTable('Devis') });
  const invoices = useQuery({ queryKey: ['client', 'Facture'], queryFn: () => loadTable('Facture') });
  const requests = useQuery({ queryKey: ['client', 'Demande'], queryFn: () => loadTable('Demande') });

  const firstName = String(user?.full_name || '').trim().split(/\s+/)[0] || 'bonjour';
  const organisation = user?.organisation || 'votre espace';
  const data = useMemo(() => ({
    projects: projects.data || [],
    quotes: quotes.data || [],
    invoices: invoices.data || [],
    requests: requests.data || [],
  }), [projects.data, quotes.data, invoices.data, requests.data]);

  const activeProjects = data.projects.filter((item) => ['en_cours', 'en_attente', 'pause'].includes(item.statut)).length;
  const openQuotes = data.quotes.filter((item) => ['envoye', 'brouillon'].includes(item.statut)).length;
  const openInvoices = data.invoices.filter((item) => ['envoyee', 'en_retard'].includes(item.statut)).length;
  const openRequests = data.requests.filter((item) => ['ouverte', 'en_traitement'].includes(item.statut)).length;
  const hasError = projects.isError || quotes.isError || invoices.isError || requests.isError;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-card to-primary/5 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Espace client</p>
            <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">Bonjour {firstName}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Retrouvez ici uniquement les informations et services liés à {organisation}. Votre assistant est disponible en bas à droite pour toute question ou demande.
            </p>
          </div>
          <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex">
            <Sparkles className="h-6 w-6" />
          </div>
        </div>
      </section>

      {hasError && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-700">
          Certaines informations sont momentanément indisponibles. Votre assistant peut néanmoins enregistrer une demande pour l’équipe JS-Innov.IA.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card icon={FolderKanban} label="Projets actifs" value={activeProjects} detail={`${data.projects.length} projet(s) au total`} href="/mes-projets" />
        <Card icon={FileText} label="Devis à suivre" value={openQuotes} detail={`${data.quotes.length} devis dans votre espace`} href="/mes-devis" />
        <Card icon={Receipt} label="Factures à suivre" value={openInvoices} detail={`${data.invoices.length} facture(s) dans votre espace`} href="/mes-factures" />
        <Card icon={MessageSquare} label="Demandes en cours" value={openRequests} detail="Vous pouvez en créer une via votre assistant" />
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Confidentialité de votre espace</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Les informations affichées ici sont limitées à votre organisation. Les données des autres clients et les outils internes de JS-Innov.IA ne sont pas accessibles depuis votre compte.
        </p>
      </section>
    </div>
  );
}
