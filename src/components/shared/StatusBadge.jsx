import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusStyles = {
  // Lead statuts
  nouveau: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  contacte: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  qualifie: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  proposition: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  gagne: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  perdu: "bg-red-500/10 text-red-600 border-red-500/20",
  // Client statuts
  actif: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactif: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  prospect: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  // Projet statuts
  en_attente: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  en_cours: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  termine: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  annule: "bg-red-500/10 text-red-600 border-red-500/20",
  // Devis / Facture
  brouillon: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  envoye: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  envoyee: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  accepte: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  refuse: "bg-red-500/10 text-red-600 border-red-500/20",
  expire: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  payee: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  en_retard: "bg-red-500/10 text-red-600 border-red-500/20",
  annulee: "bg-red-500/10 text-red-600 border-red-500/20",
  // Commission
  percue: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

const statusLabels = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  qualifie: "Qualifié",
  proposition: "Proposition",
  gagne: "Gagné",
  perdu: "Perdu",
  actif: "Actif",
  inactif: "Inactif",
  prospect: "Prospect",
  en_attente: "En attente",
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
  brouillon: "Brouillon",
  envoye: "Envoyé",
  envoyee: "Envoyée",
  accepte: "Accepté",
  refuse: "Refusé",
  expire: "Expiré",
  payee: "Payée",
  en_retard: "En retard",
  annulee: "Annulée",
  percue: "Perçue",
};

export default function StatusBadge({ status }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-medium px-2.5 py-0.5 border",
        statusStyles[status] || "bg-muted text-muted-foreground border-border"
      )}
    >
      {statusLabels[status] || status}
    </Badge>
  );
}