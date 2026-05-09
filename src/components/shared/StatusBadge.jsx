import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusStyles = {
  // Leads
  nouveau: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  contacte: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  qualifie: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  proposition: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  gagne: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  perdu: "bg-red-500/10 text-red-600 border-red-500/20",
  // Clients
  actif: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactif: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  prospect: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  // Projets
  en_attente: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  en_cours: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  termine: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  annule: "bg-red-500/10 text-red-600 border-red-500/20",
  // Devis / Factures
  brouillon: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  envoye: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  envoyee: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  accepte: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  refuse: "bg-red-500/10 text-red-600 border-red-500/20",
  expire: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  payee: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  en_retard: "bg-red-500/10 text-red-600 border-red-500/20",
  annulee: "bg-red-500/10 text-red-600 border-red-500/20",
  // Commissions
  percue: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  en_attente_paiement: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  // Tâches
  a_faire: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  en_cours_tache: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  terminee: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  bloquee: "bg-red-500/10 text-red-600 border-red-500/20",
  // Demandes
  ouverte: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  en_traitement: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  resolue: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  // Services
  disponible: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  indisponible: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  // Priorités
  haute: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  urgente: "bg-red-500/10 text-red-600 border-red-500/20",
  moyenne: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  basse: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

const statusLabels = {
  nouveau: "Nouveau", contacte: "Contacté", qualifie: "Qualifié",
  proposition: "Proposition", gagne: "Gagné", perdu: "Perdu",
  actif: "Actif", inactif: "Inactif", prospect: "Prospect",
  en_attente: "En attente", en_cours: "En cours", termine: "Terminé", annule: "Annulé",
  brouillon: "Brouillon", envoye: "Envoyé", envoyee: "Envoyée",
  accepte: "Accepté", refuse: "Refusé", expire: "Expiré",
  payee: "Payée", en_retard: "En retard", annulee: "Annulée",
  percue: "Perçue", en_attente_paiement: "En attente",
  a_faire: "À faire", en_cours_tache: "En cours", terminee: "Terminée", bloquee: "Bloquée",
  ouverte: "Ouverte", en_traitement: "En traitement", resolue: "Résolue",
  disponible: "Disponible", indisponible: "Indisponible",
  haute: "Haute", urgente: "Urgente", moyenne: "Moyenne", basse: "Basse",
};

export default function StatusBadge({ status }) {
  return (
    <Badge variant="outline" className={cn(
      "text-[11px] font-medium px-2 py-0.5 border rounded-md",
      statusStyles[status] || "bg-muted text-muted-foreground border-border"
    )}>
      {statusLabels[status] || status}
    </Badge>
  );
}
