import React from "react";
import { Check, Loader2, Send, UserRound } from "lucide-react";
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
  const [portal, setPortal] = React.useState({ requests: [], reviews: [] });
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
    if (!clientEmail) { setPortal({ requests: [], reviews: [] }); setMedia([]); return; }
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
    const mediaId = selection[request.id];
    if (!mediaId) return setError("Choisissez la vidéo finale à faire valider.");
    setBusy(request.id); setError(""); setMessage("");
    try {
      await fetch(`/api/client-signage/requests/${request.id}/reviews`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Client-Email": clientEmail },
        body: JSON.stringify({ mediaId, publishOnApproval: autoPublish[request.id] === true }),
      }).then(readJson);
      setMessage("La version est maintenant visible dans l’espace du client.");
      await load();
    } catch (reviewError) { setError(reviewError.message); }
    finally { setBusy(""); }
  };

  return (
    <section className="mb-8 rounded-2xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><UserRound className="h-5 w-5 text-blue-600" />Demandes vidéo des clients Signage</h2>
          <p className="mt-1 text-sm text-muted-foreground">Suivez la production et envoyez une version à valider.</p>
        </div>
        <label className="min-w-64 space-y-1"><span className="text-xs font-medium">Client</span><select value={clientEmail} onChange={event => chooseClient(event.target.value)} className="h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="">Choisir un client</option>{clients.map(client => <option key={client.email} value={client.email}>{client.name} — {client.email}</option>)}</select></label>
      </div>
      {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      {clientEmail && <div className="mt-5 space-y-3">
        {portal.requests.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-5 text-center text-sm text-muted-foreground">Aucune demande vidéo pour ce client.</div> : portal.requests.map(request => (
          <article key={request.id} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{request.title}</p><p className="mt-1 text-sm text-muted-foreground">{request.brief}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{request.status}</span></div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <select value={selection[request.id] || ""} onChange={event => setSelection(current => ({ ...current, [request.id]: event.target.value }))} className="h-10 rounded-xl border px-3 text-sm"><option value="">Choisir la vidéo finale</option>{media.filter(item => String(item.mime_type || "").startsWith("video/")).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <Button disabled={busy === request.id} onClick={() => submitReview(request)}>{busy === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Demander la validation</Button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={autoPublish[request.id] === true} onChange={event => setAutoPublish(current => ({ ...current, [request.id]: event.target.checked }))} />Après validation du client, programmer automatiquement cette vidéo sur son Player.</label>
            {request.status === "submitted" && <Button variant="outline" className="mt-3" disabled={busy === request.id} onClick={() => updateStatus(request, "in_production")}><Check className="mr-2 h-4 w-4" />Prendre en production</Button>}
          </article>
        ))}
      </div>}
    </section>
  );
}
