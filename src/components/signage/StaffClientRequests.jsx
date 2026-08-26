import React from "react";
import { Check, Loader2, Send, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

const MANAGED_CLIENT_KEY = "jsinnovia-managed-client";

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Action impossible");
  return body;
}

export default function StaffClientRequests() {
  const [clients, setClients] = React.useState([]);
  const [clientEmail, setClientEmail] = React.useState(() => window.localStorage.getItem(MANAGED_CLIENT_KEY) || "");
  const [portal, setPortal] = React.useState({ requests: [], reviews: [], proposals: [], comparisonTemplate: null });
  const [media, setMedia] = React.useState([]);
  const [selection, setSelection] = React.useState({});
  const [autoPublish, setAutoPublish] = React.useState({});
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    fetch("/api/signage/manage/clients?module=digital_signage", { credentials: "same-origin" })
      .then(readJson).then(body => setClients(body.clients || [])).catch(error => setError(error.message));
  }, []);

  const load = React.useCallback(async () => {
    if (!clientEmail) { setPortal({ requests: [], reviews: [], proposals: [], comparisonTemplate: null }); setMedia([]); return; }
    const headers = { "X-Client-Email": clientEmail };
    try {
      const [requests, dashboard] = await Promise.all([
        fetch("/api/client-signage/requests", { credentials: "same-origin", headers }).then(readJson),
        fetch("/api/signage/manage/dashboard", { credentials: "same-origin", headers }).then(readJson),
      ]);
      setPortal(requests);
      setMedia(dashboard.media || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [clientEmail]);

  React.useEffect(() => { load(); }, [load]);

  const chooseClient = email => {
    setClientEmail(email);
    if (email) window.localStorage.setItem(MANAGED_CLIENT_KEY, email);
    else window.localStorage.removeItem(MANAGED_CLIENT_KEY);
  };

  const updateStatus = async (request, status) => {
    setBusy(request.id); setError(""); setMessage("");
    try {
      await fetch(`/api/client-signage/requests/${request.id}`, {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Client-Email": clientEmail },
        body: JSON.stringify({ status }),
      }).then(readJson);
      setMessage("Le suivi client a été mis à jour.");
      await load();
    } catch (updateError) { setError(updateError.message); }
    finally { setBusy(""); }
  };

  const submitReview = async request => {
    const mediaIds = selection[request.id] || [];
    if (mediaIds.length !== 3 || mediaIds.some(item => !item) || new Set(mediaIds).size !== 3) {
      return setError("Choisissez trois vidéos différentes pour les propositions 1, 2 et 3.");
    }
    setBusy(request.id); setError(""); setMessage("");
    try {
      await fetch(`/api/client-signage/requests/${request.id}/reviews`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Client-Email": clientEmail },
        body: JSON.stringify({ mediaIds, publishOnApproval: autoPublish[request.id] !== false }),
      }).then(readJson);
      setMessage("Les trois propositions sont maintenant visibles dans l’espace du client.");
      await load();
    } catch (reviewError) { setError(reviewError.message); }
    finally { setBusy(""); }
  };

  const setProposal = (requestId, slot, mediaId) => {
    setSelection(current => {
      const next = [...(current[requestId] || ["", "", ""] )];
      next[slot - 1] = mediaId;
      return { ...current, [requestId]: next };
    });
  };

  const finalizeChoice = async review => {
    setBusy(review.id); setError(""); setMessage("");
    try {
      const result = await fetch(`/api/client-signage/reviews/${review.id}/finalize`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Client-Email": clientEmail },
        body: "{}",
      }).then(readJson);
      setMessage(result.publication?.id
        ? `Choix validé et diffusion programmée. Preuve : ${result.publication.id}`
        : `Choix validé, mais diffusion en attente : ${result.publicationBlockedReason || "publication manuelle"}.`);
      await load();
    } catch (finalizeError) { setError(finalizeError.message); }
    finally { setBusy(""); }
  };

  return (
    <section className="mb-8 rounded-2xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><UserRound className="h-5 w-5 text-blue-600" />Demandes vidéo des clients Signage</h2>
          <p className="mt-1 text-sm text-muted-foreground">Envoyez trois propositions, recevez le choix client, puis contrôlez la diffusion finale.</p>
        </div>
        <label className="min-w-64 space-y-1"><span className="text-xs font-medium">Client</span><select value={clientEmail} onChange={event => chooseClient(event.target.value)} className="h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="">Choisir un client</option>{clients.map(client => <option key={client.email} value={client.email}>{client.name} — {client.email}</option>)}</select></label>
      </div>
      {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      {clientEmail && portal.comparisonTemplate?.url && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">Modèle fixe de comparaison : trois emplacements de {portal.comparisonTemplate.proposalDurationSeconds}s dans le montage de {portal.comparisonTemplate.durationSeconds}s. <a className="font-semibold underline" href={portal.comparisonTemplate.url} target="_blank" rel="noreferrer">Ouvrir le modèle Canva</a>. La diffusion utilise uniquement la proposition choisie.</div>}
      {clientEmail && <div className="mt-5 space-y-3">
        {portal.requests.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-5 text-center text-sm text-muted-foreground">Aucune demande vidéo pour ce client.</div> : portal.requests.map(request => (
          <article key={request.id} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{request.title}</p><p className="mt-1 text-sm text-muted-foreground">{request.brief}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{request.status}</span></div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[1, 2, 3].map(slot => <label key={slot} className="space-y-1"><span className="text-xs font-bold uppercase tracking-wide text-amber-700">Proposition {slot}</span><select value={(selection[request.id] || [])[slot - 1] || ""} onChange={event => setProposal(request.id, slot, event.target.value)} className="h-10 w-full rounded-xl border px-3 text-sm"><option value="">Choisir une vidéo</option>{media.filter(item => String(item.mime_type || "").startsWith("video/")).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button disabled={busy === request.id} onClick={() => submitReview(request)}>{busy === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Envoyer les 3 propositions</Button>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoPublish[request.id] !== false} onChange={event => setAutoPublish(current => ({ ...current, [request.id]: event.target.checked }))} />Après mon contrôle final, programmer automatiquement la vidéo choisie.</label>
            </div>
            {portal.reviews.filter(review => review.request_id === request.id && review.status === "client_selected").map(review => {
              const chosen = media.find(item => item.id === review.selected_media_id);
              return <div key={review.id} className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                <p className="font-semibold text-emerald-900">Le client a choisi la proposition {review.selected_proposal}</p>
                <p className="mt-1 text-sm text-emerald-800">{chosen?.name || "Vidéo choisie"}{review.client_comment ? ` — ${review.client_comment}` : ""}</p>
                <Button className="mt-3" disabled={busy === review.id} onClick={() => finalizeChoice(review)}>{busy === review.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Valider définitivement et diffuser</Button>
              </div>;
            })}
            {request.status === "submitted" && <Button variant="outline" className="mt-3" disabled={busy === request.id} onClick={() => updateStatus(request, "in_production")}><Check className="mr-2 h-4 w-4" />Prendre en production</Button>}
          </article>
        ))}
      </div>}
    </section>
  );
}
