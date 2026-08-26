import React from "react";
import { CheckCircle2, Clock3, Image, Loader2, MessageSquareText, PlayCircle, UploadCloud, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const STATUS_LABELS = {
  submitted: "Demande reçue",
  in_production: "En production",
  awaiting_client: "Votre validation est demandée",
  client_choice_submitted: "Votre choix est envoyé à JS-Innov.IA",
  approved: "Validée",
  changes_requested: "Corrections demandées",
  publication_scheduled: "Diffusion programmée",
  approved_waiting_publication: "Validée — diffusion en attente",
  completed: "Terminée",
  cancelled: "Annulée",
};

async function api(path, options = {}) {
  const response = await fetch(`/api/client-signage${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Action impossible");
  return body;
}

function uploadMedia(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/signage/manage/media/upload?name=${encodeURIComponent(file.name)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Media-Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Envoi du média interrompu"));
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch { body = {}; }
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(body.error || "Envoi refusé"));
      resolve(body.media);
    };
    xhr.send(file);
  });
}

function StatusPill({ status }) {
  const waiting = status === "awaiting_client";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${waiting ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function ClientSignageRequests() {
  const [data, setData] = React.useState({ requests: [], assets: [], reviews: [], proposals: [] });
  const [media, setMedia] = React.useState([]);
  const [form, setForm] = React.useState({ title: "", brief: "", desiredAt: "", durationSeconds: 8, format: "16:9" });
  const [files, setFiles] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [comments, setComments] = React.useState({});
  const [choices, setChoices] = React.useState({});

  const load = React.useCallback(async () => {
    try {
      const [portal, dashboard] = await Promise.all([
        api("/requests"),
        fetch("/api/signage/manage/dashboard", { credentials: "same-origin" }).then(async response => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error || "Médias indisponibles");
          return body;
        }),
      ]);
      setData(portal);
      setMedia(Array.isArray(dashboard.media) ? dashboard.media : []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage(""); setProgress(0);
    try {
      const uploaded = [];
      for (let index = 0; index < files.length; index += 1) {
        const item = await uploadMedia(files[index], value => setProgress(Math.round(((index + value / 100) / files.length) * 100)));
        uploaded.push(item);
      }
      await api("/requests", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          durationSeconds: Number(form.durationSeconds || 8),
          desiredAt: form.desiredAt || null,
          requestType: "giant_screen_video",
          mediaIds: uploaded.map(item => item.id),
        }),
      });
      setForm({ title: "", brief: "", desiredAt: "", durationSeconds: 8, format: "16:9" });
      setFiles([]); setMessage("Votre demande et ses médias ont bien été transmis.");
      await load();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false); setProgress(0);
    }
  };

  const decide = async (review, decision) => {
    const proposalSlot = choices[review.id] || 1;
    if (decision === "selected" && !proposalSlot) return setError("Choisissez d’abord la proposition 1, 2 ou 3.");
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api(`/reviews/${review.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, proposalSlot, comment: comments[review.id] || "" }),
      });
      setMessage(decision === "selected"
        ? `Votre choix — proposition ${proposalSlot} — a été transmis. JS-Innov.IA le contrôlera avant diffusion.`
        : "Votre demande de correction a été transmise.");
      await load();
    } catch (decisionError) {
      setError(decisionError.message);
    } finally {
      setBusy(false);
    }
  };

  const preview = async mediaId => {
    try {
      const response = await fetch(`/api/signage/manage/media/${mediaId}/download`, { credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok || !body.url) throw new Error(body.error || "Aperçu indisponible");
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (previewError) {
      setError(previewError.message);
    }
  };

  const mediaById = React.useMemo(() => new Map(media.map(item => [item.id, item])), [media]);
  const pendingReviews = data.reviews.filter(item => item.status === "awaiting_client");
  const proposalsFor = review => {
    const rows = data.proposals.filter(item => item.review_id === review.id).sort((a, b) => a.proposal_slot - b.proposal_slot);
    return rows.length > 0 ? rows : [{ review_id: review.id, media_id: review.media_id, proposal_slot: 1 }];
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mes demandes vidéo</h1>
        <p className="mt-1 text-sm text-muted-foreground">Envoyez votre brief et vos médias, puis validez le rendu avant sa diffusion.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      {pendingReviews.length > 0 && <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquareText className="h-5 w-5 text-amber-600" /> Votre validation</h2>
        {pendingReviews.map(review => {
          const request = data.requests.find(item => item.id === review.request_id);
          const proposals = proposalsFor(review);
          return <article key={review.id} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-semibold">{request?.title || "Création vidéo"} — version {review.version}</p><p className="text-sm text-muted-foreground">Visionnez les trois propositions, puis choisissez-en une seule.</p></div>
              <StatusPill status="awaiting_client" />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {proposals.map(proposal => {
                const item = mediaById.get(proposal.media_id);
                const selected = Number(choices[review.id] || 0) === Number(proposal.proposal_slot);
                return <button key={proposal.id || proposal.proposal_slot} type="button" onClick={() => setChoices(current => ({ ...current, [review.id]: proposal.proposal_slot }))} className={`overflow-hidden rounded-2xl border-2 bg-white text-left transition ${selected ? "border-amber-500 shadow-lg ring-2 ring-amber-200" : "border-slate-200 hover:border-amber-300"}`}>
                  <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-fuchsia-950 px-4 py-6 text-center text-white">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">JS-Innov.IA présente</p>
                    <p className="mt-2 text-xl font-black text-amber-300">PROPOSITION {proposal.proposal_slot}</p>
                  </div>
                  <div className="space-y-3 p-4">
                    <p className="truncate text-sm font-medium">{item?.name || `Vidéo ${proposal.proposal_slot}`}</p>
                    <span onClick={event => { event.stopPropagation(); preview(proposal.media_id); }} className="inline-flex items-center text-sm font-semibold text-primary"><PlayCircle className="mr-2 h-4 w-4" />Voir la vidéo</span>
                    <p className={`text-xs font-semibold ${selected ? "text-amber-700" : "text-muted-foreground"}`}>{selected ? "✓ Votre choix" : "Sélectionner"}</p>
                  </div>
                </button>;
              })}
            </div>
            <textarea value={comments[review.id] || ""} onChange={event => setComments(current => ({ ...current, [review.id]: event.target.value }))} placeholder="Votre commentaire (facultatif si vous validez)" className="mt-4 min-h-24 w-full rounded-xl border bg-white p-3 text-sm" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => decide(review, "changes_requested")}><XCircle className="mr-2 h-4 w-4" />Demander une correction</Button>
              <Button disabled={busy || !choices[review.id]} onClick={() => decide(review, "selected")}><CheckCircle2 className="mr-2 h-4 w-4" />Valider la proposition {choices[review.id] || ""}</Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Votre choix ne part pas directement à l’écran : JS-Innov.IA effectue un dernier contrôle avant la programmation.</p>
          </article>;
        })}
      </section>}

      <form onSubmit={submit} className="rounded-2xl border bg-card p-5 md:p-6">
        <h2 className="text-lg font-semibold">Nouvelle demande</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Nom de la campagne</span><input required value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} className="h-11 w-full rounded-xl border px-3" placeholder="Ex. Promotion été — écran Espace C" /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Ce que vous souhaitez</span><textarea required value={form.brief} onChange={event => setForm({ ...form, brief: event.target.value })} className="min-h-28 w-full rounded-xl border p-3" placeholder="Message, offre, texte obligatoire, couleurs, coordonnées…" /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Format</span><select value={form.format} onChange={event => setForm({ ...form, format: event.target.value })} className="h-11 w-full rounded-xl border px-3"><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
          <label className="space-y-1"><span className="text-sm font-medium">Durée</span><select value={form.durationSeconds} onChange={event => setForm({ ...form, durationSeconds: event.target.value })} className="h-11 w-full rounded-xl border px-3"><option value="8">8 secondes — écran géant</option><option value="15">15 secondes</option><option value="30">30 secondes</option></select></label>
          <label className="space-y-1"><span className="text-sm font-medium">Date souhaitée</span><input type="date" value={form.desiredAt} onChange={event => setForm({ ...form, desiredAt: event.target.value })} className="h-11 w-full rounded-xl border px-3" /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Photos ou vidéos</span><input type="file" multiple accept="image/*,video/*" onChange={event => setFiles(Array.from(event.target.files || []))} className="block w-full rounded-xl border p-2 text-sm" /></label>
        </div>
        {files.length > 0 && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Image className="h-4 w-4" />{files.length} fichier(s) prêt(s) à envoyer</p>}
        {busy && progress > 0 && <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">Envoi et préparation : {progress}%</p></div>}
        <Button className="mt-5" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}Envoyer ma demande</Button>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Suivi</h2>
        {data.requests.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune demande pour le moment.</div> : data.requests.map(request => <article key={request.id} className="rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{request.title}</p><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{request.brief}</p></div><StatusPill status={request.status} /></div>
          <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{new Date(request.created_at).toLocaleString("fr-BE")} · {request.duration_seconds}s · {request.format}</p>
        </article>)}
      </section>
    </div>
  );
}
