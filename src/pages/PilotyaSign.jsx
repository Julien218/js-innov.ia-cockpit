import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  Copy,
  ExternalLink,
  MonitorPlay,
  Pencil,
  Search,
  Target,
  Trash2,
  UserPlus,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import ErrorState from "@/components/shared/ErrorState";
import FormModal from "@/components/shared/FormModal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const PILOTYA_URL = "https://pilotyasign.jsinnovia.com/";
const PROSPECT_MARKER = "[PILOTYASIGN:ECRAN_ESPACE_C_DOUR]";
const PROSPECT_CONTEXT = "Publicité écran géant Espace C Dour";

const formFields = [
  { name: "entreprise", label: "Entreprise / commerce", type: "text", required: true },
  { name: "nom", label: "Nom du contact", type: "text", required: true },
  { name: "prenom", label: "Prénom", type: "text" },
  { name: "email", label: "E-mail", type: "email", required: true },
  { name: "telephone", label: "Téléphone", type: "text" },
  {
    name: "statut",
    label: "Étape commerciale",
    type: "select",
    options: ["nouveau", "contacte", "qualifie", "proposition", "gagne", "perdu"],
  },
  { name: "notes", label: "Notes de prospection", type: "textarea" },
];

const isPilotyaProspect = (lead = {}) => {
  const notes = String(lead.notes || "");
  return notes.includes(PROSPECT_MARKER)
    || String(lead.source || "").toLowerCase() === "pilotyasign";
};

const displayNotes = (notes = "") => String(notes)
  .replace(PROSPECT_MARKER, "")
  .replace(/^\s*Canal\s*:\s*Publicité écran géant Espace C Dour\s*/i, "")
  .trim();

const taggedNotes = (notes = "") => {
  const clean = displayNotes(notes);
  return [
    PROSPECT_MARKER,
    `Canal: ${PROSPECT_CONTEXT}`,
    clean,
  ].filter(Boolean).join("\n");
};

const outreachText = "Bonjour, je vous contacte au sujet d’une visibilité locale sur notre écran LED géant situé à l’Espace C de Dour. Nous proposons des diffusions publicitaires courtes pour les commerces et entreprises de la région. Souhaitez-vous recevoir les formats, disponibilités et une proposition adaptée à votre activité ?";

export default function PilotyaSign() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");

  const { data: leads = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Lead"],
    queryFn: () => base44.entities.Lead.list("-created_at"),
  });

  const prospects = useMemo(
    () => (Array.isArray(leads) ? leads : []).filter(isPilotyaProspect),
    [leads],
  );

  const filteredProspects = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("fr");
    if (!needle) return prospects;
    return prospects.filter((lead) => [
      lead.entreprise,
      lead.nom,
      lead.prenom,
      lead.email,
      lead.telephone,
      lead.statut,
    ].some((value) => String(value || "").toLocaleLowerCase("fr").includes(needle)));
  }, [prospects, search]);

  const stats = useMemo(() => ({
    total: prospects.length,
    aContacter: prospects.filter((lead) => ["nouveau", "qualifie"].includes(lead.statut)).length,
    enCours: prospects.filter((lead) => ["contacte", "proposition"].includes(lead.statut)).length,
    gagnes: prospects.filter((lead) => lead.statut === "gagne").length,
  }), [prospects]);

  const save = useMutation({
    mutationFn: (data) => {
      const payload = {
        ...data,
        source: editing?.source || "autre",
        statut: data.statut || editing?.statut || "nouveau",
        notes: taggedNotes(data.notes),
      };
      return editing
        ? base44.entities.Lead.update(editing.id, payload)
        : base44.entities.Lead.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["Lead"] });
      setOpen(false);
      setEditing(null);
      toast({
        title: editing ? "Prospect mis à jour" : "Prospect ajouté",
        description: "Le contact est centralisé dans le pipeline PilotyaSign · Espace C Dour.",
      });
    },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Lead.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["Lead"] }),
  });

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing({ ...row, notes: displayNotes(row.notes) });
    setOpen(true);
  };

  const copyOutreach = async () => {
    try {
      await navigator.clipboard.writeText(outreachText);
      toast({ title: "Message copié", description: "Le texte d’approche est prêt à être personnalisé." });
    } catch {
      toast({ title: "Copie impossible", description: outreachText, variant: "destructive" });
    }
  };

  const columns = [
    { key: "entreprise", label: "Entreprise" },
    { key: "nom", label: "Contact", render: (value, row) => `${value || ""} ${row.prenom || ""}`.trim() || "—" },
    { key: "email", label: "E-mail" },
    { key: "telephone", label: "Téléphone", render: (value) => value || "—" },
    { key: "statut", label: "Étape", render: (value) => <StatusBadge status={value || "nouveau"} /> },
    { key: "created_at", label: "Créé le", render: (value) => value ? new Date(value).toLocaleDateString("fr-BE") : "—" },
  ];

  const actions = (row) => (
    <div className="flex gap-2">
      <Button size="icon" variant="ghost" title="Modifier" onClick={() => openEdit(row)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="text-red-500"
        title="Supprimer"
        onClick={() => {
          if (confirm(`Supprimer le prospect ${row.entreprise || row.nom || ""} ?`)) del.mutate(row.id);
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );

  if (isError) {
    return (
      <ErrorState
        title="Prospection PilotyaSign indisponible"
        message={error?.message || "Impossible de charger les prospects."}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="PilotyaSign · Prospection écran géant"
        subtitle="Centralisez vos prospects intéressés par une publicité sur l’écran LED de l’Espace C à Dour, puis poursuivez devis, contrat et signature dans PilotyaSign."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={PILOTYA_URL} target="_blank" rel="noopener noreferrer">
                <BriefcaseBusiness className="mr-2 h-4 w-4" />
                Ouvrir PilotyaSign
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button onClick={openCreate}>
              <UserPlus className="mr-2 h-4 w-4" />
              Nouveau prospect
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prospects ciblés</p>
          <p className="mt-2 text-3xl font-bold">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">À contacter / qualifier</p>
          <p className="mt-2 text-3xl font-bold">{stats.aContacter}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">En discussion</p>
          <p className="mt-2 text-3xl font-bold">{stats.enCours}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gagnés</p>
          <p className="mt-2 text-3xl font-bold">{stats.gagnes}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Target className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h2 className="font-semibold">Parcours commercial centralisé</h2>
              <p className="text-sm text-muted-foreground">
                1. Ajouter ou qualifier un commerce ici. 2. Suivre le contact dans le pipeline. 3. Ouvrir PilotyaSign pour préparer la proposition, le devis, le contrat, la signature et le paiement.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/ecran-geant">
                  <MonitorPlay className="mr-2 h-4 w-4" />
                  Voir le module Signelya
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Message d’approche</h2>
          <p className="mt-2 text-sm text-muted-foreground">{outreachText}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={copyOutreach}>
            <Copy className="mr-2 h-4 w-4" />
            Copier le message
          </Button>
        </section>
      </div>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">Prospects publicité · Espace C Dour</h2>
            <p className="text-sm text-muted-foreground">
              Cette vue utilise les Leads du Cockpit avec un marquage dédié, sans créer une base parallèle.
            </p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un commerce…"
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <DataTable columns={columns} data={filteredProspects} loading={isLoading} actions={actions} />
      </section>

      <FormModal
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Modifier le prospect PilotyaSign" : "Nouveau prospect PilotyaSign"}
        fields={formFields}
        initialData={editing || { statut: "nouveau" }}
        onSubmit={(data) => save.mutate(data)}
        loading={save.isPending}
      />
    </div>
  );
}
