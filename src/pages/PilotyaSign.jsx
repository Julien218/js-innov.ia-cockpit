import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
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
const DEFAULT_ZONE = "Dour, Belgique";

const SECTORS = [
  { value: "all", label: "Tous secteurs" },
  { value: "retail", label: "Commerces" },
  { value: "horeca", label: "Horeca" },
  { value: "beauty", label: "Beauté & bien-être" },
  { value: "auto", label: "Automobile" },
  { value: "health", label: "Santé" },
  { value: "services", label: "Services & professions" },
  { value: "leisure", label: "Loisirs & sport" },
];

const formFields = [
  { name: "entreprise", label: "Entreprise / commerce", type: "text", required: true },
  { name: "nom", label: "Nom du contact", type: "text", required: true },
  { name: "prenom", label: "Prénom", type: "text" },
  { name: "email", label: "E-mail", type: "email" },
  { name: "telephone", label: "Téléphone", type: "text" },
  {
    name: "statut",
    label: "Étape commerciale",
    type: "select",
    options: ["nouveau", "contacte", "qualifie", "proposition", "gagne", "perdu"],
  },
  { name: "notes", label: "Notes de prospection", type: "textarea" },
];

const normalize = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("fr")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const safeExternalUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
};

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

const candidateNotes = (candidate = {}) => taggedNotes([
  "Prospect découvert par Elynea via une recherche publique OpenStreetMap.",
  candidate.category ? `Catégorie: ${candidate.category}` : "",
  candidate.address ? `Adresse: ${candidate.address}` : "",
  candidate.website ? `Site: ${candidate.website}` : "",
  candidate.facebook ? `Facebook: ${candidate.facebook}` : "",
  candidate.id ? `Référence source: ${candidate.id}` : "",
  "Coordonnées à vérifier avant prise de contact.",
].filter(Boolean).join("\n"));

const outreachText = "Bonjour, je vous contacte au sujet d’une visibilité locale sur notre écran LED géant situé à l’Espace C de Dour. Nous proposons des diffusions publicitaires courtes pour les commerces et entreprises de la région. Souhaitez-vous recevoir les formats, disponibilités et une proposition adaptée à votre activité ?";

export default function PilotyaSign() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState(DEFAULT_ZONE);
  const [sector, setSector] = useState("all");
  const [radius, setRadius] = useState("12000");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discovery, setDiscovery] = useState(null);

  const { data: leads = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["Lead"],
    queryFn: () => base44.entities.Lead.list("-created_at"),
  });

  const allLeads = Array.isArray(leads) ? leads : [];
  const prospects = useMemo(
    () => allLeads.filter(isPilotyaProspect),
    [allLeads],
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

  const duplicateLeadFor = (candidate = {}) => {
    const email = normalize(candidate.email);
    const phone = normalize(candidate.phone);
    const name = normalize(candidate.name);
    return allLeads.find((lead) => {
      const leadEmail = normalize(lead.email);
      const leadPhone = normalize(lead.telephone);
      const company = normalize(lead.entreprise);
      const contactName = normalize([lead.nom, lead.prenom].filter(Boolean).join(" "));
      return (email && leadEmail && email === leadEmail)
        || (phone && leadPhone && phone === leadPhone)
        || (name && (name === company || name === contactName));
    }) || null;
  };

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

  const addCandidate = useMutation({
    mutationFn: (candidate) => base44.entities.Lead.create({
      entreprise: candidate.name,
      nom: candidate.name,
      prenom: "",
      email: candidate.email || "",
      telephone: candidate.phone || "",
      source: "autre",
      statut: "nouveau",
      notes: candidateNotes(candidate),
    }),
    onSuccess: (_data, candidate) => {
      qc.invalidateQueries({ queryKey: ["Lead"] });
      toast({
        title: "Prospect ajouté au pipeline",
        description: `${candidate.name} est prêt à être qualifié et contacté.`,
      });
    },
    onError: (mutationError, candidate) => {
      setEditing({
        entreprise: candidate.name,
        nom: candidate.name,
        prenom: "",
        email: candidate.email || "",
        telephone: candidate.phone || "",
        statut: "nouveau",
        notes: candidateNotes(candidate),
      });
      setOpen(true);
      toast({
        title: "Complétez la fiche avant ajout",
        description: mutationError?.message || "Certaines données obligatoires sont absentes.",
        variant: "destructive",
      });
    },
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Lead.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["Lead"] }),
  });

  const runDiscovery = async () => {
    setDiscovering(true);
    setDiscoveryError("");
    try {
      const params = new URLSearchParams({
        zone: zone.trim() || DEFAULT_ZONE,
        sector,
        radius: String(radius || "12000"),
      });
      const response = await fetch(`/api/pilotyasign-prospecting/search?${params.toString()}`, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(35000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }
      setDiscovery(payload);
    } catch (discoveryFailure) {
      setDiscovery(null);
      setDiscoveryError(discoveryFailure?.message || "Recherche indisponible.");
    } finally {
      setDiscovering(false);
    }
  };

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
    { key: "email", label: "E-mail", render: (value) => value || "—" },
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
        subtitle="Elynea centralise vos prospects pour l’écran LED de l’Espace C à Dour, puis PilotyaSign prend le relais pour devis, contrat, signature et paiement."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={PILOTYA_URL} target="_blank" rel="noopener noreferrer">
                <Briefcase className="mr-2 h-4 w-4" />
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

      <section className="space-y-5 rounded-xl border border-primary/30 bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">Prospection assistée par Elynea</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Elynea recherche en direct des commerces publics dans la zone choisie, détecte les doublons déjà présents dans votre CRM et vous laisse décider lesquels ajouter au pipeline.
            </p>
          </div>
          <Button onClick={runDiscovery} disabled={discovering}>
            {discovering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            {discovering ? "Recherche…" : "Rechercher des prospects"}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[1.3fr_.8fr_.7fr]">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Zone</span>
            <input
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              placeholder="Dour, Belgique"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Secteur</span>
            <select
              value={sector}
              onChange={(event) => setSector(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            >
              {SECTORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Rayon</span>
            <select
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="5000">5 km</option>
              <option value="12000">12 km</option>
              <option value="20000">20 km</option>
              <option value="25000">25 km</option>
            </select>
          </label>
        </div>

        {discoveryError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{discoveryError}</div>
        )}

        {discovery && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{discovery.resolved_zone || discovery.zone}</span>
              <span>{Math.round((discovery.radius_m || 0) / 1000)} km</span>
              <span>{discovery.sector_label}</span>
              <span>{discovery.count} résultat(s)</span>
              <span>
                Source : <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">© contributeurs OpenStreetMap</a> / Overpass
              </span>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {(discovery.candidates || []).map((candidate) => {
                const duplicate = duplicateLeadFor(candidate);
                return (
                  <article key={candidate.id} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{candidate.name}</h3>
                        <p className="text-xs capitalize text-muted-foreground">{candidate.category || "commerce"}</p>
                      </div>
                      <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        {candidate.score || 0}/100
                      </div>
                    </div>

                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      {candidate.address && <p>{candidate.address}</p>}
                      {candidate.phone && <p>{candidate.phone}</p>}
                      {candidate.email && <p>{candidate.email}</p>}
                      {safeExternalUrl(candidate.website) && (
                        <a href={safeExternalUrl(candidate.website)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Globe className="h-3.5 w-3.5" />
                          Site web
                        </a>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {duplicate ? (
                        <Button size="sm" variant="outline" disabled>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Déjà dans le CRM
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => addCandidate.mutate(candidate)}
                          disabled={addCandidate.isPending}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          Ajouter au pipeline
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Les coordonnées proviennent de données publiques et peuvent être incomplètes. Elynea évite les doublons CRM, mais une vérification humaine reste nécessaire avant contact commercial.
            </p>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Target className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h2 className="font-semibold">Parcours commercial centralisé</h2>
              <p className="text-sm text-muted-foreground">
                Recherche Elynea → qualification → contact → proposition → PilotyaSign → devis → contrat → signature → paiement → client Signelya.
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
