import React from "react";
import { Trash2, Film } from "lucide-react";

async function call(path, options = {}, clientEmail = "") {
  const response = await fetch(`/api/signage${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(clientEmail ? { "X-Client-Email": clientEmail } : {}), ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { throw new Error("Réponse du cockpit illisible"); }
  }
  if (!response.ok) throw new Error(body.error || "Opération impossible");
  return body;
}

const formatBytes = bytes => {
  const value = Number(bytes || 0);
  if (!value) return "0 octet";
  const units = ["octets", "Ko", "Mo", "Go"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
};

export default function SignageMediaManager({ managedClient = "" }) {
  const [media, setMedia] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState("");
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const dashboard = await call("/manage/dashboard", {}, managedClient);
      setMedia(Array.isArray(dashboard.media) ? dashboard.media : []);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, [managedClient]);

  React.useEffect(() => { load(); }, [load]);

  const remove = async item => {
    const confirmed = window.confirm(`Supprimer définitivement « ${item.name} » ?\n\nLe fichier sera retiré de Dropbox et de la médiathèque. Cette action est irréversible.`);
    if (!confirmed) return;
    setDeletingId(item.id);
    setMessage("");
    try {
      const result = await call(`/manage/media/${item.id}`, { method: "DELETE" }, managedClient);
      setMessage(result.adjustedPlaylists
        ? `Média supprimé. ${result.adjustedPlaylists} playlist(s) ont été automatiquement nettoyées.`
        : "Média supprimé de la médiathèque et de Dropbox.");
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDeletingId("");
    }
  };

  return <div className="rounded-2xl border bg-card p-5 space-y-4">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Film className="w-5 h-5" /></div>
      <div className="flex-1">
        <h2 className="text-sm font-semibold">Gestion de la médiathèque</h2>
        <p className="text-xs text-muted-foreground mt-1">Supprimez les vidéos et images devenues inutiles. Une diffusion active ou en attente reste protégée.</p>
      </div>
      <button type="button" onClick={load} disabled={loading} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">Actualiser</button>
    </div>

    {message && <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">{message}</div>}

    <div className="divide-y rounded-xl border">
      {media.map(item => <div key={item.id} className="flex items-center gap-3 p-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.name}</p>
          <p className="text-xs text-muted-foreground">{formatBytes(item.size_bytes)} · {item.mime_type || "média"} · {item.status || "inconnu"}</p>
        </div>
        <button
          type="button"
          disabled={Boolean(deletingId)}
          onClick={() => remove(item)}
          className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-700 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-2"
          aria-label={`Supprimer ${item.name}`}
        >
          <Trash2 className="w-4 h-4" />
          {deletingId === item.id ? "Suppression…" : "Supprimer"}
        </button>
      </div>)}
      {!media.length && <p className="p-3 text-xs text-muted-foreground">{loading ? "Chargement…" : "Aucun média à supprimer."}</p>}
    </div>
  </div>;
}
