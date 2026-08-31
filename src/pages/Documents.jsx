import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Cloud,
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.csv,.txt";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-BE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileIcon(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();
  if (mime.startsWith("image/")) return FileImage;
  if (mime.includes("spreadsheet") || mime.includes("excel") || /\.(xlsx?|csv)$/.test(name)) return FileSpreadsheet;
  if (mime.includes("pdf") || mime.includes("word") || /\.(pdf|docx?)$/.test(name)) return FileText;
  return File;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(new Error(`Lecture impossible : ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function Documents() {
  const inputRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [brand, setBrand] = useState("jsinnovia");
  const [clientId, setClientId] = useState("");
  const [category, setCategory] = useState("documents");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statusRes, docsRes] = await Promise.all([
        fetch("/api/documents/status", { credentials: "same-origin" }),
        fetch("/api/documents?limit=200", { credentials: "same-origin" }),
      ]);
      const statusData = await statusRes.json();
      const docsData = await docsRes.json();
      if (!statusRes.ok || !statusData.success) throw new Error(statusData.error || "Statut Dropbox indisponible");
      if (!docsRes.ok || !docsData.success) throw new Error(docsData.error || "Index documentaire indisponible");
      setStatus(statusData);
      setDocuments(docsData.documents || []);
    } catch (err) {
      setError(err.message || "Impossible de charger les documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('cockpit-documents-changed', load);
    return () => window.removeEventListener('cockpit-documents-changed', load);
  }, [load]);

  const brands = useMemo(() => [...new Set(documents.map(d => d.brand).filter(Boolean))].sort(), [documents]);
  const categories = useMemo(() => [...new Set(documents.map(d => d.category).filter(Boolean))].sort(), [documents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((doc) => {
      if (brandFilter !== "all" && doc.brand !== brandFilter) return false;
      if (categoryFilter !== "all" && doc.category !== categoryFilter) return false;
      if (!q) return true;
      return [doc.filename, doc.client_id, doc.brand, doc.category, doc.uploaded_by]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [documents, search, brandFilter, categoryFilter]);

  const totals = useMemo(() => ({
    count: documents.length,
    bytes: documents.reduce((sum, d) => sum + Number(d.size_bytes || 0), 0),
    clients: new Set(documents.map(d => d.client_id).filter(Boolean)).size,
  }), [documents]);

  const handleFiles = (incoming) => {
    const selected = Array.from(incoming || []);
    const invalid = selected.find(f => f.size > MAX_FILE_BYTES);
    if (invalid) {
      setError(`${invalid.name} dépasse la limite de 10 Mo.`);
      return;
    }
    setFiles(selected);
    setError("");
  };

  const upload = async () => {
    if (!files.length) return setError("Sélectionnez au moins un document.");
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      for (const file of files) {
        const base64 = await fileToBase64(file);
        const response = await fetch("/api/documents/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            base64,
            brand: brand.trim() || "general",
            clientId: clientId.trim() || null,
            category: category.trim() || "documents",
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || `Upload impossible : ${file.name}`);
      }
      setSuccess(`${files.length} document${files.length > 1 ? "s" : ""} archivé${files.length > 1 ? "s" : ""} dans Dropbox.`);
      setFiles([]);
      setUploadOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Erreur pendant l’archivage.");
    } finally {
      setUploading(false);
    }
  };

  const download = async (doc) => {
    setError("");
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/download`, { credentials: "same-origin" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Téléchargement impossible");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.filename || "document";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Téléchargement impossible.");
    }
  };

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto">
      <section className="rounded-3xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="p-5 sm:p-7 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300 mb-2">
                <ShieldCheck className="w-4 h-4" /> Coffre documentaire sécurisé
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Centre Documents</h1>
              <p className="text-sm text-slate-300 mt-2 max-w-2xl">
                Les fichiers restent dans Dropbox. Le Cockpit conserve uniquement leur index métier pour les retrouver par client, marque et catégorie.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-sm font-medium disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualiser
              </button>
              <button onClick={() => setUploadOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#D4AF37] text-black hover:bg-[#e1be50] text-sm font-semibold shadow-lg shadow-amber-500/10">
                <Upload className="w-4 h-4" /> Ajouter des documents
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-7">
            <Metric icon={Archive} label="Documents indexés" value={totals.count} />
            <Metric icon={HardDrive} label="Volume indexé" value={formatBytes(totals.bytes)} />
            <Metric icon={FolderOpen} label="Clients liés" value={totals.clients} />
            <Metric
              icon={Cloud}
              label="Dropbox"
              value={status?.dropboxConfigured ? "Connecté" : "À configurer"}
              good={Boolean(status?.dropboxConfigured)}
            />
          </div>
        </div>
      </section>

      {error && <Notice type="error" text={error} onClose={() => setError("")} />}
      {success && <Notice type="success" text={success} onClose={() => setSuccess("")} />}

      <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un nom, client, marque, catégorie…"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <FilterSelect value={brandFilter} onChange={setBrandFilter} label="Toutes les marques" options={brands} />
            <FilterSelect value={categoryFilter} onChange={setCategoryFilter} label="Toutes les catégories" options={categories} />
          </div>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <span className="text-sm">Chargement du coffre documentaire…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center px-4">
            <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <h2 className="font-semibold mt-3">Aucun document trouvé</h2>
            <p className="text-sm text-muted-foreground mt-1">Ajoutez un fichier ou modifiez vos filtres.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold px-5 py-3">Document</th>
                  <th className="text-left font-semibold px-4 py-3">Client</th>
                  <th className="text-left font-semibold px-4 py-3">Marque</th>
                  <th className="text-left font-semibold px-4 py-3">Catégorie</th>
                  <th className="text-left font-semibold px-4 py-3">Source</th>
                  <th className="text-left font-semibold px-4 py-3">Ajouté le</th>
                  <th className="text-right font-semibold px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((doc) => {
                  const Icon = fileIcon(doc.mime_type, doc.filename);
                  return (
                    <tr key={doc.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-primary/8 text-primary flex items-center justify-center flex-shrink-0">
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate max-w-[320px]" title={doc.filename}>{doc.filename}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(doc.size_bytes)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">{doc.client_id || "—"}</td>
                      <td className="px-4 py-4"><Tag>{doc.brand || "general"}</Tag></td>
                      <td className="px-4 py-4"><Tag subtle>{doc.category || "documents"}</Tag></td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">{doc.source || "cockpit"}</td>
                      <td className="px-4 py-4 text-xs text-muted-foreground whitespace-nowrap">{formatDate(doc.created_at)}</td>
                      <td className="px-5 py-4 text-right">
                        <button onClick={() => download(doc)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border hover:bg-muted text-xs font-medium">
                          <Download className="w-3.5 h-3.5" /> Télécharger
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        Aucun lien Dropbox public n’est généré. Les téléchargements passent par votre session Cockpit.
      </div>

      {uploadOpen && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-5">
          <div className="w-full sm:max-w-2xl bg-card border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-border flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Archiver dans Dropbox</h2>
                <p className="text-sm text-muted-foreground mt-1">Les fichiers sont stockés dans Dropbox et seulement indexés dans Supabase.</p>
              </div>
              <button onClick={() => !uploading && setUploadOpen(false)} className="p-2 rounded-xl hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
                className="border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-7 text-center cursor-pointer transition-colors bg-muted/20"
              >
                <Upload className="w-8 h-8 mx-auto text-primary" />
                <p className="text-sm font-semibold mt-3">Cliquez ou déposez vos documents ici</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, images, Word, Excel, CSV, TXT — 10 Mo maximum par fichier</p>
                <input ref={inputRef} type="file" multiple accept={ACCEPTED} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  {files.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background">
                      <File className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-sm truncate flex-1">{file.name}</span>
                      <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Marque" value={brand} onChange={setBrand} placeholder="jsinnovia" />
                <Field label="Client / dossier" value={clientId} onChange={setClientId} placeholder="Nom ou ID client" />
                <Field label="Catégorie" value={category} onChange={setCategory} placeholder="documents" />
              </div>
            </div>

            <div className="p-5 border-t border-border flex justify-end gap-2">
              <button onClick={() => setUploadOpen(false)} disabled={uploading} className="px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-muted disabled:opacity-50">Annuler</button>
              <button onClick={upload} disabled={uploading || files.length === 0} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                {uploading ? "Archivage…" : "Archiver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, good = false }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-slate-400"><Icon className="w-4 h-4" /> {label}</div>
      <div className={`text-xl font-bold mt-1.5 ${good ? "text-emerald-300" : "text-white"}`}>{value}</div>
    </div>
  );
}

function FilterSelect({ value, onChange, label, options }) {
  return (
    <div className="relative min-w-[185px]">
      <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-11 pl-9 pr-8 rounded-xl bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20">
        <option value="all">{label}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

function Tag({ children, subtle = false }) {
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ${subtle ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{children}</span>;
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full h-10 px-3 rounded-xl bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20" />
    </label>
  );
}

function Notice({ type, text, onClose }) {
  const success = type === "success";
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 text-sm ${success ? "bg-emerald-500/8 border-emerald-500/25 text-emerald-700" : "bg-red-500/8 border-red-500/25 text-red-700"}`}>
      {success ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />}
      <span className="flex-1">{text}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
    </div>
  );
}
