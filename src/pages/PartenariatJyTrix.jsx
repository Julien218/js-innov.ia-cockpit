import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  FolderKanban,
  Handshake,
  Mail,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";

const roleCards = [
  {
    title: "Super Admin JS-Innov.IA",
    description: "Pilotage global, stratégie client, supervision commerciale, automatisations et validation finale.",
    icon: ShieldCheck,
    badge: "Contrôle total",
  },
  {
    title: "Admin JY-Trix.AI",
    description: "Production technique, développement IA, exécution des livrables et suivi opérationnel partenaire.",
    icon: Bot,
    badge: "Production IA",
  },
  {
    title: "Client",
    description: "Transmission de la demande, validation des informations, suivi des projets et réception des livrables.",
    icon: UserCheck,
    badge: "Validation",
  },
];

const processSteps = [
  {
    title: "1. Entrée de la demande",
    description: "Formulaire, landing page, téléphone IA, email, réseaux sociaux ou commande directe.",
    icon: MessageSquare,
  },
  {
    title: "2. Qualification IA",
    description: "L'agent classe la demande, détecte l'urgence, résume le besoin et propose la prochaine action.",
    icon: Sparkles,
  },
  {
    title: "3. Attribution partenaire",
    description: "JS-Innov.IA garde la vision client. JY-Trix.AI reçoit les éléments de production selon le type de mission.",
    icon: Handshake,
  },
  {
    title: "4. Suivi jusqu'à livraison",
    description: "Projet, devis, relance, validation, commande, paiement et livraison restent centralisés dans le cockpit.",
    icon: CheckCircle2,
  },
];

const sourceCards = [
  { label: "Formulaires", icon: Mail, description: "Landing pages, devis, commandes" },
  { label: "Téléphone IA", icon: Phone, description: "Appels, messages, rappels" },
  { label: "Réseaux", icon: Target, description: "Facebook, Instagram, TikTok, LinkedIn" },
  { label: "Automatisations", icon: Zap, description: "Make, webhook, Airtable, CRM" },
];

const safeCount = (items, predicate) => items.filter(predicate).length;

export default function PartenariatJyTrix() {
  const { data: demandes = [] } = useQuery({
    queryKey: ["demandes"],
    queryFn: () => base44.entities.Demande.list("-created_at"),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => base44.entities.Client.list(),
  });
  const { data: projets = [] } = useQuery({
    queryKey: ["projets"],
    queryFn: () => base44.entities.Projet.list(),
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["leads"],
    queryFn: () => base44.entities.Lead.list(),
  });

  const stats = useMemo(() => {
    const demandesOuvertes = safeCount(demandes, (d) => d.statut === "ouverte");
    const demandesUrgentes = safeCount(demandes, (d) => ["haute", "urgente"].includes(d.priorite));
    const projetsActifs = safeCount(projets, (p) => !["termine", "terminee", "cloture", "livre"].includes(p.statut));
    const leadsActifs = safeCount(leads, (l) => !["gagne", "perdu"].includes(l.statut));

    return [
      { label: "Demandes ouvertes", value: demandesOuvertes, icon: MessageSquare },
      { label: "Demandes urgentes", value: demandesUrgentes, icon: Clock },
      { label: "Clients suivis", value: clients.length, icon: Users },
      { label: "Projets actifs", value: projetsActifs, icon: FolderKanban },
      { label: "Leads actifs", value: leadsActifs, icon: Target },
    ];
  }, [clients.length, demandes, leads, projets]);

  const recentDemandes = useMemo(() => demandes.slice(0, 5), [demandes]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-[#0a0a14] p-6 text-white shadow-xl">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#D4AF37]/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />

        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-center">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-[#D4AF37]">
              <Handshake className="h-3.5 w-3.5" />
              JS-Innov.IA x JY-Trix.AI
            </div>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight md:text-4xl" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Centre de commande pour centraliser les demandes, commandes et suivis clients.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
              Un espace unique pour transformer chaque formulaire, appel, message ou commande en demande qualifiée, projet suivi, relance planifiée et livraison maîtrisée.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/demandes" className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-bold text-[#0a0a14] shadow-lg shadow-[#D4AF37]/20 transition hover:scale-[1.01]">
                Voir les demandes <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/projets" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15">
                Suivre les projets
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/50">Flux idéal</p>
            <div className="mt-4 space-y-3 text-sm">
              {[
                "Demande reçue",
                "Qualification IA",
                "Attribution JS / JY-Trix",
                "Devis ou commande",
                "Production & livraison",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-[#D4AF37]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <stat.icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Répartition des responsabilités</h2>
              <p className="text-sm text-muted-foreground">Les rôles corrigés pour clarifier le partenariat.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {roleCards.map((role) => (
              <article key={role.title} className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <role.icon className="h-5 w-5" />
                </div>
                <div className="mb-2 inline-flex rounded-full bg-[#D4AF37]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#8a6d1f]">
                  {role.badge}
                </div>
                <h3 className="text-sm font-bold text-foreground">{role.title}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{role.description}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Sources à centraliser</h2>
          <div className="mt-4 space-y-3">
            {sourceCards.map((source) => (
              <div key={source.label} className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <source.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{source.label}</p>
                  <p className="text-xs text-muted-foreground">{source.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Dernières demandes</h2>
            <Link to="/demandes" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Voir tout <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="divide-y divide-border">
            {recentDemandes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <MessageSquare className="mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">Aucune demande pour le moment.</p>
              </div>
            ) : (
              recentDemandes.map((demande) => (
                <div key={demande.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{demande.titre || "Demande sans titre"}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{demande.contenu || demande.message || "Aucun détail renseigné."}</p>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                      {demande.source || "source"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Processus cockpit</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {processSteps.map((step) => (
              <article key={step.title} className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <step.icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">{step.title}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="text-base font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Prochaine évolution recommandée</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajouter une action automatique : nouvelle demande reçue → résumé IA → statut “À qualifier” → notification JS-Innov.IA → attribution éventuelle à JY-Trix.AI.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/agents-ia" className="rounded-xl border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/70">
              Configurer agent IA
            </Link>
            <Link to="/services" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90">
              Voir services
            </Link>
          </div>
        </div>
      </section>

      <p className="pb-2 text-center text-xs text-muted-foreground">
        JS-Innov.IA x JY-Trix.AI — Automatisation intelligente amplifiée par l'humain.
      </p>
    </div>
  );
}
