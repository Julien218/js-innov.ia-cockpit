import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Search, Store, MapPin, Globe, Facebook, Instagram,
  Music4, Linkedin, ShieldCheck, Copy, Sparkles, Building2, Clock, BadgeCheck, ArrowUpRight, ChevronRight,
  Download, Loader2, CheckCircle2
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ───────────────────────────────────────────
const CATEGORIES = [
  "Alimentation", "Restauration", "Beauté & Bien-être", "Mode & Vêtements",
  "Services", "Artisanat", "Sport & Loisirs", "Santé", "Autre"
];

const STATUS_STYLES = {
  nouveau: "border-l-orange-500 bg-orange-500/5",
  publié: "border-l-emerald-500 bg-emerald-500/5",
  contacté: "border-l-blue-500 bg-blue-500/5",
  refusé: "border-l-red-500 bg-red-500/5",
};

const STATUS_BADGE = {
  nouveau: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  publié: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  contacté: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  refusé: "bg-red-500/10 text-red-400 border-red-500/30",
};

const STATUS_LABEL = { nouveau: "Nouveau", contacté: "Contacté", publié: "Publié", refusé: "Refusé" };

const CATEGORY_COLORS = {
  "Alimentation": "bg-amber-500/10 text-amber-400 border-amber-500/30",
  "Restauration": "bg-orange-500/10 text-orange-400 border-orange-500/30",
  "Beauté & Bien-être": "bg-pink-500/10 text-pink-400 border-pink-500/30",
  "Mode & Vêtements": "bg-purple-500/10 text-purple-400 border-purple-500/30",
  "Services": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "Artisanat": "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  "Sport & Loisirs": "bg-green-500/10 text-green-400 border-green-500/30",
  "Santé": "bg-red-500/10 text-red-400 border-red-500/30",
  "Autre": "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

// ─── Components ────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-[#111122] border border-white/5 rounded-xl p-4 flex items-center gap-4">
      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</p>
      </div>
    </div>
  );
}

function MerchantCard({ merchant, onClick }) {
  const initials = (merchant.nom_commerce || "?")
    .split(" ")
    .map(w => w[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  const socials = [];
  if (merchant.facebook) socials.push({ icon: Facebook, url: merchant.facebook, color: "text-blue-400" });
  if (merchant.instagram) socials.push({ icon: Instagram, url: merchant.instagram, color: "text-pink-400" });
  if (merchant.tiktok) socials.push({ icon: Music4, url: merchant.tiktok, color: "text-slate-300" });
  if (merchant.linkedin) socials.push({ icon: Linkedin, url: merchant.linkedin, color: "text-blue-500" });
  if (merchant.site_web) socials.push({ icon: Globe, url: merchant.site_web, color: "text-emerald-400" });

  return (
    <div
      onClick={() => onClick(merchant)}
      className={cn(
        "bg-[#111122] border border-white/5 rounded-xl p-4 cursor-pointer",
        "hover:border-[#3B82F6]/30 hover:shadow-lg hover:shadow-[#3B82F6]/5",
        "transition-all duration-200 border-l-[3px]",
        STATUS_STYLES[merchant.statut] || "border-l-slate-500"
      )}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-[#1a1a2e] border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
          {merchant.logo_photo_url ? (
            <img src={merchant.logo_photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-[#3B82F6]">{initials}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{merchant.nom_commerce}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", CATEGORY_COLORS[merchant.categorie_activite] || "bg-slate-500/10 text-slate-400")}>
              {merchant.categorie_activite || "Non classé"}
            </Badge>
            {merchant.ville && (
              <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" /> {merchant.ville}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", STATUS_BADGE[merchant.statut])}>
          {STATUS_LABEL[merchant.statut]}
        </Badge>
        <div className="flex items-center gap-1.5">
          {socials.slice(0, 3).map((s, i) => (
            <s.icon key={i} className={cn("w-3 h-3", s.color)} />
          ))}
          {socials.length > 3 && <span className="text-[10px] text-slate-500">+{socials.length - 3}</span>}
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
        </div>
      </div>
    </div>
  );
}

function PostGenerationModal({ open, onClose, merchant, onGenerated }) {
  const [posts, setPosts] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const prompt = `Tu es un expert en marketing local et community management pour la plateforme VilleConnect à Dour (Belgique).

Génère 3 posts pour le commerce suivant :
- Nom : ${merchant.nom_commerce}
- Catégorie : ${merchant.categorie_activite || "Non spécifié"}
- Description : ${merchant.description || "Pas de description"}
- Ville : ${merchant.ville || "Dour"}

Génère exactement 3 posts distincts :
1. Un post Facebook : ton amical, engageant, avec émojis, hashtags #Dour #CommerceLocal #VilleConnect
2. Un post Instagram : court, punchy, visuel, avec hashtags pertinents
3. Un post TikTok : accroche courte style vidéo, punchy, tendance

Réponds uniquement avec ce JSON :
{
  "facebook": "le post Facebook complet",
  "instagram": "le post Instagram complet",
  "tiktok": "le post TikTok complet"
}`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            facebook: { type: "string" },
            instagram: { type: "string" },
            tiktok: { type: "string" },
          },
        },
      });

      setPosts(response);
      onGenerated?.();
    } catch (err) {
      toast.error("Erreur lors de la génération des posts");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Post copié !");
  };

  const platformConfig = [
    { key: "facebook", label: "Facebook", icon: Facebook, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
    { key: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/20" },
    { key: "tiktok", label: "TikTok", icon: Music4, color: "text-slate-300", bg: "bg-slate-500/10 border-slate-500/20" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-[#0d0d1a] border-white/10">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#3B82F6]" />
            Générer un post IA pour {merchant.nom_commerce}
          </DialogTitle>
        </DialogHeader>

        {!posts && !loading && (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm mb-4">
              L'IA va générer 3 posts (Facebook, Instagram, TikTok) basés sur les informations du commerce.
            </p>
            <Button onClick={generate} className="gradient-primary border-0 text-white">
              <Sparkles className="w-4 h-4 mr-2" /> Générer les posts
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center py-12 gap-4">
            <Loader2 className="w-8 h-8 text-[#3B82F6] animate-spin" />
            <p className="text-slate-400 text-sm">Génération des posts en cours...</p>
          </div>
        )}

        {posts && (
          <div className="space-y-4">
            {platformConfig.map((plat) => (
              <div key={plat.key} className={cn("rounded-xl border p-4", plat.bg)}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <plat.icon className={cn("w-4 h-4", plat.color)} />
                    <span className="text-sm font-semibold text-white">{plat.label}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-slate-400 hover:text-white"
                    onClick={() => copyToClipboard(posts[plat.key])}
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copier
                  </Button>
                </div>
                <p className="text-sm text-slate-300 whitespace-pre-wrap">{posts[plat.key]}</p>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setPosts(null)} className="border-white/10 text-slate-400">
                Régénérer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MerchantDetailSheet({ merchant, open, onClose, onStatusChange, onGeneratePost }) {
  const [notes, setNotes] = useState(merchant?.notes_internes || "");
  const [savingNotes, setSavingNotes] = useState(false);

  const saveNotes = async () => {
    setSavingNotes(true);
    await base44.entities.MerchantSubmission.update(merchant.id, { notes_internes: notes });
    setSavingNotes(false);
    toast.success("Notes sauvegardées");
  };

  if (!merchant) return null;

  const socialLinks = [
    { key: "facebook", icon: Facebook, color: "text-blue-400 hover:text-blue-300", label: "Facebook" },
    { key: "instagram", icon: Instagram, color: "text-pink-400 hover:text-pink-300", label: "Instagram" },
    { key: "tiktok", icon: Music4, color: "text-slate-400 hover:text-slate-300", label: "TikTok" },
    { key: "linkedin", icon: Linkedin, color: "text-blue-500 hover:text-blue-400", label: "LinkedIn" },
  ];

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg bg-[#0d0d1a] border-white/10 text-white overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#1a1a2e] border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
              {merchant.logo_photo_url ? (
                <img src={merchant.logo_photo_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <Store className="w-5 h-5 text-[#3B82F6]" />
              )}
            </div>
            <div>
              <span className="block text-lg">{merchant.nom_commerce}</span>
              <Badge variant="outline" className={cn("text-[10px] mt-0.5", STATUS_BADGE[merchant.statut])}>
                {STATUS_LABEL[merchant.statut]}
              </Badge>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          {/* Infos générales */}
          <div className="bg-[#111122] rounded-xl border border-white/5 p-4 space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Informations</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {merchant.categorie_activite && (
                <div>
                  <span className="text-slate-500 text-xs">Catégorie</span>
                  <p className="text-white">{merchant.categorie_activite}</p>
                </div>
              )}
              {merchant.type_commerce && (
                <div>
                  <span className="text-slate-500 text-xs">Type</span>
                  <p className="text-white">{merchant.type_commerce}</p>
                </div>
              )}
              {merchant.ville && (
                <div>
                  <span className="text-slate-500 text-xs">Ville</span>
                  <p className="text-white flex items-center gap-1"><MapPin className="w-3 h-3" /> {merchant.ville}</p>
                </div>
              )}
              {merchant.adresse && (
                <div>
                  <span className="text-slate-500 text-xs">Adresse</span>
                  <p className="text-white">{merchant.adresse}</p>
                </div>
              )}
              {merchant.email_interne && (
                <div className="col-span-2">
                  <span className="text-slate-500 text-xs">Email</span>
                  <p className="text-[#3B82F6]">{merchant.email_interne}</p>
                </div>
              )}
            </div>
            {merchant.description && (
              <div>
                <span className="text-slate-500 text-xs">Description</span>
                <p className="text-sm text-slate-300 mt-1">{merchant.description}</p>
              </div>
            )}
            <div className="flex items-center gap-3 text-xs">
              {merchant.client_pv_assurances && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">
                  <ShieldCheck className="w-3 h-3" /> Client PV Assurances
                </div>
              )}
              {merchant.consentement_rgpd && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 text-blue-400">
                  <CheckCircle2 className="w-3 h-3" /> RGPD OK
                </div>
              )}
            </div>
          </div>

          {/* Réseaux sociaux */}
          {socialLinks.some(s => merchant[s.key]) && (
            <div className="bg-[#111122] rounded-xl border border-white/5 p-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Réseaux sociaux</h4>
              <div className="flex flex-wrap gap-2">
                {socialLinks.map(s => merchant[s.key] && (
                  <a key={s.key} href={merchant[s.key]} target="_blank" rel="noopener noreferrer"
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs transition-colors", s.color)}>
                    <s.icon className="w-3.5 h-3.5" />
                    {s.label}
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                ))}
                {merchant.site_web && (
                  <a href={merchant.site_web} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                    <Globe className="w-3.5 h-3.5" /> Site web <ArrowUpRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="bg-[#111122] rounded-xl border border-white/5 p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Actions</h4>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => onGeneratePost(merchant)}
                className="bg-[#3B82F6] hover:bg-[#3B82F6]/80 text-white"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Générer post IA
              </Button>
              {merchant.statut !== "publié" && (
                <Button
                  size="sm"
                  onClick={() => onStatusChange(merchant, "publié")}
                  className="bg-emerald-600 hover:bg-emerald-600/80 text-white"
                >
                  Publier
                </Button>
              )}
              {merchant.statut === "nouveau" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStatusChange(merchant, "contacté")}
                  className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                >
                  Marquer contacté
                </Button>
              )}
              {merchant.statut !== "refusé" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStatusChange(merchant, "refusé")}
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  Refuser
                </Button>
              )}
            </div>
          </div>

          {/* Notes internes */}
          <div className="bg-[#111122] rounded-xl border border-white/5 p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Notes internes</h4>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes internes..."
              className="bg-[#0d0d1a] border-white/10 text-white text-sm h-24 resize-none"
            />
            <Button size="sm" variant="ghost" onClick={saveNotes} disabled={savingNotes}
              className="mt-2 text-xs text-slate-400 hover:text-white">
              {savingNotes ? "Sauvegarde..." : "Sauvegarder"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ─────────────────────────────────────────
export default function Commercants() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statutFilter, setStatutFilter] = useState("all");
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [showPostModal, setShowPostModal] = useState(false);
  const [importing, setImporting] = useState(false);

  const { data: merchants = [], isLoading } = useQuery({
    queryKey: ["merchantSubmissions"],
    queryFn: () => base44.entities.MerchantSubmission.list("-created_at"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MerchantSubmission.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchantSubmissions"] });
      toast.success("Statut mis à jour");
    },
  });

  // Stats
  const stats = useMemo(() => ({
    total: merchants.length,
    publies: merchants.filter(m => m.statut === "publié").length,
    enAttente: merchants.filter(m => m.statut === "nouveau").length,
    pvAssurances: merchants.filter(m => m.client_pv_assurances).length,
  }), [merchants]);

  // Filtrage
  const filtered = useMemo(() => {
    return merchants.filter(m => {
      const matchSearch = !search || m.nom_commerce?.toLowerCase().includes(search.toLowerCase());
      const matchCat = catFilter === "all" || m.categorie_activite === catFilter;
      const matchStatut = statutFilter === "all" || m.statut === statutFilter;
      return matchSearch && matchCat && matchStatut;
    });
  }, [merchants, search, catFilter, statutFilter]);

  const handleStatusChange = (merchant, newStatut) => {
    const updates = { statut: newStatut };
    if (newStatut === "publié") updates.synced_to_railway = true;
    updateMutation.mutate({ id: merchant.id, data: updates });
    setSelectedMerchant({ ...merchant, ...updates });
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const response = await base44.functions.invoke("importFormSubmissions", {});
      const { imported, total } = response.data;
      queryClient.invalidateQueries({ queryKey: ["merchantSubmissions"] });
      toast.success(`${imported} nouveau(x) commerçant(s) importé(s) sur ${total}`);
    } catch (err) {
      toast.error("Erreur lors de l'importation");
    } finally {
      setImporting(false);
    }
  };

  const handlePostGenerated = async () => {
    if (selectedMerchant) {
      await base44.entities.MerchantSubmission.update(selectedMerchant.id, {
        posts_generes: (selectedMerchant.posts_generes || 0) + 1,
      });
      queryClient.invalidateQueries({ queryKey: ["merchantSubmissions"] });
    }
  };

  return (
    <div className="min-h-screen bg-[#070712] p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            <Store className="w-5 h-5 text-[#3B82F6]" />
            Commerçants VilleConnect
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Gestion des commerçants locaux de Dour</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleImport}
            disabled={importing}
            className="border-[#3B82F6]/30 text-[#3B82F6] hover:bg-[#3B82F6]/10"
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
            Importer depuis formulaire
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Building2} label="Total inscrits" value={stats.total} color="bg-[#3B82F6]/10 text-[#3B82F6]" />
        <StatCard icon={BadgeCheck} label="Publiés" value={stats.publies} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={Clock} label="En attente" value={stats.enAttente} color="bg-orange-500/10 text-orange-400" />
        <StatCard icon={ShieldCheck} label="Clients PV Ass." value={stats.pvAssurances} color="bg-[#06B6D4]/10 text-[#06B6D4]" />
      </div>

      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            placeholder="Rechercher un commerce..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm bg-[#111122] border-white/10 text-white"
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-full sm:w-44 h-9 text-sm bg-[#111122] border-white/10 text-white">
            <SelectValue placeholder="Catégorie" />
          </SelectTrigger>
          <SelectContent className="bg-[#111122] border-white/10">
            <SelectItem value="all">Toutes catégories</SelectItem>
            {CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statutFilter} onValueChange={setStatutFilter}>
          <SelectTrigger className="w-full sm:w-36 h-9 text-sm bg-[#111122] border-white/10 text-white">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent className="bg-[#111122] border-white/10">
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="nouveau">Nouveau</SelectItem>
            <SelectItem value="contacté">Contacté</SelectItem>
            <SelectItem value="publié">Publié</SelectItem>
            <SelectItem value="refusé">Refusé</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array(8).fill(0).map((_, i) => (
            <div key={i} className="bg-[#111122] border border-white/5 rounded-xl p-4">
              <Skeleton className="h-4 w-3/4 mb-2 bg-white/5" />
              <Skeleton className="h-3 w-1/2 bg-white/5" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Store className="w-12 h-12 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500">Aucun commerçant trouvé</p>
          <p className="text-xs text-slate-600 mt-1">Importez des données depuis le formulaire</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(m => (
            <MerchantCard
              key={m.id}
              merchant={m}
              onClick={(merchant) => setSelectedMerchant(merchant)}
            />
          ))}
        </div>
      )}

      {/* Detail Sheet */}
      <MerchantDetailSheet
        merchant={selectedMerchant}
        open={!!selectedMerchant}
        onClose={() => setSelectedMerchant(null)}
        onStatusChange={handleStatusChange}
        onGeneratePost={(m) => {
          setSelectedMerchant(m);
          setShowPostModal(true);
        }}
      />

      {/* Post Generation Modal */}
      {selectedMerchant && (
        <PostGenerationModal
          open={showPostModal}
          onClose={() => setShowPostModal(false)}
          merchant={selectedMerchant}
          onGenerated={handlePostGenerated}
        />
      )}
    </div>
  );
}