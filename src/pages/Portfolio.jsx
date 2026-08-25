import React, { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
const useMutationAny = /** @type {any} */ (useMutation);
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import StatCard from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Image as ImageIcon, Video, FileText, CheckCircle2, XCircle, Eye, EyeOff,
  Archive, Sparkles, History, Package, AlertTriangle, Loader2, Cloud,
  Download, RefreshCw, Search, FolderOpen,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

const typeIcons = { image: ImageIcon, video: Video, document: FileText };

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

function dropboxMediaType(asset) {
  const mime = String(asset?.mime_type || "").toLowerCase();
  return mime.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(asset?.filename || "") ? "video" : "image";
}

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const color = score >= 75 ? "text-emerald-600 bg-emerald-500/10" : score >= 50 ? "text-amber-600 bg-amber-500/10" : "text-red-600 bg-red-500/10";
  return <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-md", color)}>{score}/100</span>;
}

// Actions sensibles nécessitant une confirmation explicite
const CONFIRM_ACTIONS = {
  valider: {
    title: "Valider cet Asset ?",
    description: "Le statut passera à 'Validé'. Cette action sera enregistrée avec ton nom dans l'historique.",
  },
  publier: {
    title: "Publier cet Asset dans le Portfolio public ?",
    description: "Il deviendra visible sur le site et dans les vues publiques (PortfolioView). Cette action est irréversible sans une nouvelle intervention manuelle.",
  },
  retirer: {
    title: "Retirer cet Asset du Portfolio public ?",
    description: "Il ne sera plus visible publiquement, mais reste dans la bibliothèque (statut inchangé).",
  },
  archiver: {
    title: "Archiver cet Asset ?",
    description: "Il sera masqué de toutes les vues actives (mais pas supprimé).",
  },
  refuser: {
    title: "Refuser cet Asset ?",
    description: "Il passera en statut 'À retravailler'.",
  },
};

export default function Portfolio() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatut, setFilterStatut] = useState("");
  const [librarySource, setLibrarySource] = useState(searchParams.get("source") === "dropbox" ? "dropbox" : "cockpit");
  const [dropboxSearch, setDropboxSearch] = useState("");
  const [dropboxType, setDropboxType] = useState(["image", "video"].includes(searchParams.get("type")) ? searchParams.get("type") : "all");
  const [onlyUnclassified, setOnlyUnclassified] = useState(searchParams.get("client") === "unclassified");
  const [assigningAsset, setAssigningAsset] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [historyAsset, setHistoryAsset] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type, asset }

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => base44.entities.Asset.list("-created_date"),
    staleTime: 15000,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["portfolio-clients"],
    queryFn: () => base44.entities.Client.list("entreprise"),
    staleTime: 60_000,
  });

  const {
    data: dropboxLibrary = { assets: [], dropboxConfigured: false },
    isLoading: dropboxLoading,
    isFetching: dropboxRefreshing,
    error: dropboxError,
    refetch: refreshDropbox,
  } = useQuery({
    queryKey: ["portfolio-dropbox-assets"],
    queryFn: async () => {
      const response = await fetch("/api/documents/portfolio-assets?limit=500", { credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Bibliothèque Dropbox indisponible");
      return data;
    },
    staleTime: 30_000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["asset-history", historyAsset?.id],
    queryFn: () => base44.entities.AssetHistory.filter({ asset_id: historyAsset.id }),
    enabled: !!historyAsset,
  });

  const effectuePar = user?.full_name ? `${user.full_name} (via Cockpit)` : "Julien (via Cockpit)";

  const logHistory = async (assetId, action, ancien, nouveau, details) => {
    await base44.entities.AssetHistory.create({
      asset_id: assetId,
      action,
      ancien_statut: ancien,
      nouveau_statut: nouveau,
      details,
      effectue_par: effectuePar,
    });
  };

  const actionMutation = useMutationAny({
    mutationFn: async ({ type, asset }) => {
      const now = new Date().toISOString();
      if (type === "valider") {
        await base44.entities.Asset.update(asset.id, { statut: "valide", valide_le: now });
        await logHistory(asset.id, "validation", asset.statut, "valide", `Validé manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "publier") {
        await base44.entities.Asset.update(asset.id, { statut: "publie", portfolio_visible: true, publie_le: now });
        await logHistory(asset.id, "publication", asset.statut, "publie", `Publié manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "retirer") {
        await base44.entities.Asset.update(asset.id, { portfolio_visible: false });
        await logHistory(asset.id, "modification", asset.statut, asset.statut, `Retiré du Portfolio public par ${effectuePar} (statut inchangé).`);
      } else if (type === "archiver") {
        await base44.entities.Asset.update(asset.id, { statut: "archive", portfolio_visible: false });
        await logHistory(asset.id, "archivage", asset.statut, "archive", `Archivé manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "refuser") {
        await base44.entities.Asset.update(asset.id, { statut: "a_retravailler" });
        await logHistory(asset.id, "refus", asset.statut, "a_retravailler", `Refusé manuellement depuis le Cockpit par ${effectuePar}.`);
      } else if (type === "analyser") {
        await logHistory(asset.id, "modification", asset.statut, asset.statut, `Demande de ré-analyse IA envoyée par ${effectuePar} depuis le Cockpit (traitée par l'agent Portfolio JS-Innov.IA).`);
      }
    },
    onSuccess: (_, { type }) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-history"] });
      toast({ title: "Action effectuée", description: `${type} appliqué avec succès.` });
      setConfirmAction(null);
    },
    onError: (err) => {
      toast({ title: "Erreur", description: String(err.message || err), variant: "destructive" });
    },
  });

  const assignClientMutation = useMutationAny({
    mutationFn: async ({ asset, clientId }) => {
      const client = clients.find((item) => String(item.id) === String(clientId));
      if (!client) throw new Error("Sélectionne un client valide");
      const clientName = client.denomination_legale || client.entreprise || client.nom || client.name || "Client";
      const response = await fetch(`/api/documents/portfolio-assets/${encodeURIComponent(asset.id)}/client`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: String(client.id), clientName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "Rattachement impossible");
      return { ...data, clientName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-dropbox-assets"] });
      toast({
        title: "Média rattaché",
        description: `${data.clientName} · journal ${data.journalId || "enregistré"}`,
      });
      setAssigningAsset(null);
      setSelectedClientId("");
      setClientSearch("");
    },
    onError: (error) => toast({ title: "Rattachement impossible", description: error.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    if (!filterStatut) return assets;
    return assets.filter(a => a.statut === filterStatut);
  }, [assets, filterStatut]);

  const stats = useMemo(() => ({
    total: assets.length,
    enAttente: assets.filter(a => a.statut === "en_attente_validation").length,
    publies: assets.filter(a => a.statut === "publie").length,
    visibles: assets.filter(a => a.portfolio_visible).length,
  }), [assets]);

  const clientNames = useMemo(() => new Map(clients.map((client) => [
    String(client.id),
    client.denomination_legale || client.entreprise || client.nom || client.name || "Client",
  ])), [clients]);

  const dropboxAssets = dropboxLibrary.assets || [];
  const filteredDropboxAssets = useMemo(() => {
    const query = dropboxSearch.trim().toLowerCase();
    return dropboxAssets.filter((asset) => {
      const mediaType = dropboxMediaType(asset);
      if (dropboxType !== "all" && mediaType !== dropboxType) return false;
      if (onlyUnclassified && asset.client_id) return false;
      if (!query) return true;
      const client = asset.client_id ? clientNames.get(String(asset.client_id)) : "à classer";
      return [asset.filename, asset.category, asset.brand, asset.source, asset.dropbox_path, client]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [dropboxAssets, dropboxSearch, dropboxType, onlyUnclassified, clientNames]);

  const assignableClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    return clients
      .map((client) => ({
        id: String(client.id),
        name: client.denomination_legale || client.entreprise || client.nom || client.name || "Client",
      }))
      .filter((client) => !query || client.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [clients, clientSearch]);

  const dropboxStats = useMemo(() => ({
    total: dropboxAssets.length,
    images: dropboxAssets.filter((asset) => dropboxMediaType(asset) === "image").length,
    videos: dropboxAssets.filter((asset) => dropboxMediaType(asset) === "video").length,
    unclassified: dropboxAssets.filter((asset) => !asset.client_id).length,
  }), [dropboxAssets]);

  const statutOptions = ["", "brouillon", "analyse_ia", "en_attente_validation", "valide", "a_retravailler", "publie", "archive"];

  return (
    <div>
      <PageHeader
        title="Portfolio — Bibliothèque Asset"
        subtitle="Créations Cockpit et médias Dropbox réunis dans une seule bibliothèque"
        actions={
          librarySource === "cockpit" ? (
            <select
              value={filterStatut}
              onChange={(e) => setFilterStatut(e.target.value)}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background"
            >
              <option value="">Tous les statuts</option>
              {statutOptions.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant={onlyUnclassified ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyUnclassified((value) => !value)}
              >
                <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> À classer
              </Button>
              <Button variant="outline" size="sm" onClick={() => refreshDropbox()} disabled={dropboxRefreshing}>
                <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", dropboxRefreshing && "animate-spin")} /> Actualiser Dropbox
              </Button>
            </div>
          )
        }
      />

      <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1 mb-5">
        <Button size="sm" variant={librarySource === "cockpit" ? "default" : "ghost"} onClick={() => setLibrarySource("cockpit")}>
          <Package className="w-4 h-4 mr-1.5" /> Assets Cockpit
        </Button>
        <Button size="sm" variant={librarySource === "dropbox" ? "default" : "ghost"} onClick={() => setLibrarySource("dropbox")}>
          <Cloud className="w-4 h-4 mr-1.5" /> Médias Dropbox
          {dropboxLibrary.dropboxConfigured && <span className="ml-2 h-2 w-2 rounded-full bg-emerald-400" title="Dropbox connecté" />}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {librarySource === "cockpit" ? <>
          <StatCard title="Assets total" value={stats.total} icon={Package} color="primary" />
          <StatCard title="En attente de validation" value={stats.enAttente} icon={AlertTriangle} color="warning" />
          <StatCard title="Publiés" value={stats.publies} icon={CheckCircle2} color="success" />
          <StatCard title="Visibles Portfolio" value={stats.visibles} icon={Eye} color="accent" />
        </> : <>
          <StatCard title="Médias Dropbox" value={dropboxStats.total} icon={Cloud} color="primary" />
          <StatCard title="Images" value={dropboxStats.images} icon={ImageIcon} color="accent" />
          <StatCard title="Vidéos" value={dropboxStats.videos} icon={Video} color="success" />
          <StatCard title="À classer" value={dropboxStats.unclassified} icon={FolderOpen} color="warning" />
        </>}
      </div>

      {librarySource === "dropbox" && (
        <div className="rounded-2xl border border-border bg-card p-4 mb-5">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={dropboxSearch}
                onChange={(event) => setDropboxSearch(event.target.value)}
                placeholder="Rechercher un fichier, un client, une campagne…"
                className="w-full h-10 rounded-xl border border-border bg-background pl-9 pr-3 text-sm"
              />
            </div>
            <select value={dropboxType} onChange={(event) => setDropboxType(event.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
              <option value="all">Images et vidéos</option>
              <option value="image">Images seulement</option>
              <option value="video">Vidéos seulement</option>
            </select>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Les fichiers restent dans Dropbox. Le Cockpit affiche l’index sécurisé créé par NOVA et les générateurs vidéo.
          </p>
        </div>
      )}

      {librarySource === "cockpit" ? (isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Aucun Asset pour ce filtre.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((asset) => {
            const Icon = typeIcons[asset.type_media] || FileText;
            return (
              <div key={asset.id} className="bg-card rounded-2xl border border-border overflow-hidden card-hover flex flex-col">
                <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                  {asset.miniature_url ? (
                    <img src={asset.miniature_url} alt={asset.titre} className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground line-clamp-2">{asset.titre || "(sans titre)"}</h3>
                    {asset.portfolio_visible ? (
                      <span title="Visible dans le Portfolio public"><Eye className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" /></span>
                    ) : (
                      <span title="Non visible publiquement"><EyeOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" /></span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{asset.description || "Pas de description."}</p>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <StatusBadge status={asset.statut} />
                    {asset.categorie && <Badge variant="outline" className="text-[10px]">{asset.categorie}</Badge>}
                    <ScoreBadge score={asset.score_qualite} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {asset.created_date && format(new Date(asset.created_date), "d MMM yyyy à HH:mm", { locale: fr })} · source: {asset.source || "?"}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setConfirmAction({ type: "analyser", asset })}>
                      <Sparkles className="w-3 h-3 mr-1" /> Ré-analyser
                    </Button>
                    {asset.statut !== "valide" && asset.statut !== "publie" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => setConfirmAction({ type: "valider", asset })}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Valider
                      </Button>
                    )}
                    {asset.statut !== "publie" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-primary border-primary/30 hover:bg-primary/10" onClick={() => setConfirmAction({ type: "publier", asset })}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Publier
                      </Button>
                    )}
                    {asset.portfolio_visible && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setConfirmAction({ type: "retirer", asset })}>
                        <EyeOff className="w-3 h-3 mr-1" /> Retirer
                      </Button>
                    )}
                    {asset.statut !== "a_retravailler" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => setConfirmAction({ type: "refuser", asset })}>
                        <XCircle className="w-3 h-3 mr-1" /> Refuser
                      </Button>
                    )}
                    {asset.statut !== "archive" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-slate-600" onClick={() => setConfirmAction({ type: "archiver", asset })}>
                        <Archive className="w-3 h-3 mr-1" /> Archiver
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setHistoryAsset(asset)}>
                      <History className="w-3 h-3 mr-1" /> Historique
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )) : dropboxLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Lecture de la bibliothèque Dropbox…
        </div>
      ) : dropboxError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Dropbox ne peut pas être affiché : {dropboxError.message}
        </div>
      ) : !dropboxLibrary.dropboxConfigured ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Dropbox n’est pas configuré sur le Cockpit. Aucun fichier local n’est supprimé ou déplacé.
        </div>
      ) : filteredDropboxAssets.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Aucun média Dropbox ne correspond à cette recherche.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDropboxAssets.map((asset) => {
            const mediaType = dropboxMediaType(asset);
            const contentUrl = `/api/documents/${encodeURIComponent(asset.id)}/content`;
            const clientName = asset.client_id ? clientNames.get(String(asset.client_id)) : null;
            return (
              <article key={asset.id} className="bg-card rounded-2xl border border-border overflow-hidden card-hover flex flex-col">
                <div className="aspect-video bg-slate-950 flex items-center justify-center overflow-hidden">
                  {mediaType === "image" ? (
                    <img src={contentUrl} alt={asset.filename} loading="lazy" className="w-full h-full object-contain" />
                  ) : (
                    <video src={contentUrl} controls preload="metadata" className="w-full h-full object-contain" aria-label={asset.filename} />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground line-clamp-2" title={asset.filename}>{asset.filename}</h3>
                    <span title="Stocké dans Dropbox"><Cloud className="w-4 h-4 text-blue-500 flex-shrink-0" /></span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{mediaType === "video" ? "Vidéo" : "Image"}</Badge>
                    <Badge variant="outline" className="text-[10px]">{asset.category}</Badge>
                    <button
                      type="button"
                      onClick={() => {
                        setAssigningAsset(asset);
                        setSelectedClientId(asset.client_id ? String(asset.client_id) : "");
                        setClientSearch("");
                      }}
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        clientName ? "bg-emerald-600" : "bg-amber-600",
                      )}
                      aria-label={`${clientName ? "Modifier le client" : "Identifier le client"} de ${asset.filename}`}
                      title="Cliquer pour choisir le client"
                    >
                      {clientName || "Client à identifier"}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatBytes(asset.size_bytes)} · source : {asset.source}</p>
                  <p className="text-[10px] text-muted-foreground break-all line-clamp-2" title={asset.dropbox_path || ""}>{asset.dropbox_path || "Chemin Dropbox indexé"}</p>
                  <div className="mt-auto pt-2 border-t border-border flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      {asset.created_at ? format(new Date(asset.created_at), "d MMM yyyy à HH:mm", { locale: fr }) : "Date inconnue"}
                    </span>
                    <Button asChild size="sm" variant="outline" className="h-7 text-[11px]">
                      <a href={contentUrl} download={asset.filename}><Download className="w-3 h-3 mr-1" /> Télécharger</a>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!assigningAsset} onOpenChange={(open) => !open && setAssigningAsset(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rattacher ce média à un client</DialogTitle>
            <DialogDescription>
              {assigningAsset?.filename}. Le fichier reste dans Dropbox ; son index Cockpit sera relié au client choisi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
              placeholder="Rechercher un client…"
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
            />
            <select
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              aria-label="Client à rattacher"
            >
              <option value="">Choisir un client</option>
              {assignableClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            {assignableClients.length === 0 && <p className="text-xs text-amber-600">Aucun client ne correspond à cette recherche.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAssigningAsset(null)}>Annuler</Button>
              <Button
                onClick={() => assignClientMutation.mutate({ asset: assigningAsset, clientId: selectedClientId })}
                disabled={!selectedClientId || assignClientMutation.isPending}
              >
                {assignClientMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Enregistrer le client
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal historique */}
      <Dialog open={!!historyAsset} onOpenChange={(open) => !open && setHistoryAsset(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historique — {historyAsset?.titre}</DialogTitle>
            <DialogDescription>Traçabilité complète (AssetHistory)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {history.length === 0 && <p className="text-xs text-muted-foreground">Aucun historique.</p>}
            {history
              .slice()
              .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
              .map((h) => (
                <div key={h.id} className="border border-border rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">{h.action}</span>
                    <span className="text-muted-foreground">{h.created_date && format(new Date(h.created_date), "d MMM HH:mm", { locale: fr })}</span>
                  </div>
                  {h.ancien_statut && h.nouveau_statut && (
                    <p className="text-muted-foreground mb-1">{h.ancien_statut} → {h.nouveau_statut}</p>
                  )}
                  <p className="text-foreground">{h.details}</p>
                  <p className="text-muted-foreground mt-1 italic">par {h.effectue_par || "?"}</p>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation actions sensibles */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction && (CONFIRM_ACTIONS[confirmAction.type]?.title || "Confirmer l'action ?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction && (CONFIRM_ACTIONS[confirmAction.type]?.description || "Déclencher une ré-analyse IA de cet Asset.")}
              {confirmAction?.asset && <span className="block mt-2 font-medium text-foreground">Asset : {confirmAction.asset.titre}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionMutation.isPending}
              onClick={() => actionMutation.mutate(confirmAction)}
            >
              {actionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
